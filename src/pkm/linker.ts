/**
 * 컨텍스트 기반 관련 노트 링커
 *
 * PKM 시스템에서 관련 문서를 찾고, Claude를 사용하여
 * WHY 관련되는지 맥락적 설명을 생성한 뒤 [[wikilink]]로 연결한다.
 * Obsidian 호환 포맷 사용.
 */

import * as fs from "fs/promises";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { parse } from "./frontmatter.js";
import { embed } from "../memory/embeddings.js";
import { search } from "../memory/vectorStore.js";

// ============================================
// 타입 정의
// ============================================

/** 관련 노트 검색 결과 */
export interface RelatedNote {
  path: string;
  name: string;       // wikilink용 문서명 (확장자 제외)
  score: number;       // 유사도 점수 (0~1)
  content: string;
}

/** 컨텍스트 링크 생성 대상 문서 */
export interface DocumentInfo {
  path: string;
  content: string;
}

// ============================================
// 상수
// ============================================

/** 관련 노트 섹션 헤더 */
const RELATED_SECTION_HEADER = "## 관련 노트";

/** 관련 노트 섹션 매칭 정규식 (헤더부터 다음 ##까지 또는 파일 끝까지) */
const RELATED_SECTION_REGEX = /## 관련 노트\n[\s\S]*?(?=\n## |\n---\s*$|$)/;

/** 벡터 검색 최소 유사도 */
const MIN_SEARCH_SCORE = 0.3;

/** Claude 모델 (Sonnet) */
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

/** Claude 응답 최대 토큰 */
const MAX_TOKENS = 1024;

// ============================================
// Anthropic 클라이언트 (싱글톤)
// ============================================

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

// ============================================
// 유틸리티
// ============================================

/**
 * 파일 경로에서 문서명을 추출한다 (확장자 제외).
 * wikilink [[문서명]] 형태로 사용.
 */
function extractDocName(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

/**
 * 문서 내용을 요약용으로 잘라낸다 (토큰 절약).
 * frontmatter 본문만 추출하여 최대 길이 제한.
 */
function truncateContent(content: string, maxLength = 2000): string {
  const { body } = parse(content);
  const trimmed = body.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.slice(0, maxLength) + "\n...(이하 생략)";
}

// ============================================
// 1. 관련 노트 검색
// ============================================

/**
 * 현재 문서와 관련된 노트를 벡터 검색으로 찾는다.
 *
 * @param filePath - 현재 문서 경로 (자기 자신 필터링용)
 * @param content - 현재 문서 내용
 * @param topK - 반환할 최대 개수 (기본 5)
 * @returns 관련 노트 목록 (점수순 정렬)
 */
export async function findRelatedNotes(
  filePath: string,
  content: string,
  topK: number = 5,
): Promise<RelatedNote[]> {
  // 문서 내용을 임베딩
  const { body } = parse(content);
  const queryEmbedding = await embed(body);

  // 자기 자신을 제외하고 여유있게 검색 (topK + 2)
  const searchResults = await search(queryEmbedding, topK + 2, MIN_SEARCH_SCORE);

  // 현재 문서명으로 자기 자신 필터링
  const selfName = extractDocName(filePath).toLowerCase();

  const related: RelatedNote[] = [];

  for (const result of searchResults) {
    // source가 현재 문서와 동일하면 건너뜀
    const resultName = extractDocName(result.source).toLowerCase();
    if (resultName === selfName) continue;

    related.push({
      path: result.source,
      name: extractDocName(result.source),
      score: result.score,
      content: result.text,
    });

    if (related.length >= topK) break;
  }

  return related;
}

// ============================================
// 2. 컨텍스트 링크 생성 (Claude 호출)
// ============================================

/**
 * Claude를 호출하여 관련 노트 섹션을 생성한다.
 * 각 관련 문서가 WHY 관련되는지 구체적 맥락 설명 포함.
 *
 * @param currentDoc - 현재 문서 정보
 * @param relatedDocs - 관련 문서 목록 (점수 포함)
 * @returns "## 관련 노트" 마크다운 섹션 문자열
 */
export async function generateContextLinks(
  currentDoc: DocumentInfo,
  relatedDocs: Array<{ path: string; content: string; score: number }>,
): Promise<string> {
  if (relatedDocs.length === 0) {
    return `${RELATED_SECTION_HEADER}\n\n_관련 노트 없음_\n`;
  }

  const currentName = extractDocName(currentDoc.path);
  const currentBody = truncateContent(currentDoc.content);

  // 관련 문서 컨텍스트 구성
  const relatedContext = relatedDocs
    .map((doc, i) => {
      const docName = extractDocName(doc.path);
      const docBody = truncateContent(doc.content, 1500);
      return `### 관련 문서 ${i + 1}: ${docName} (유사도: ${doc.score.toFixed(3)})\n${docBody}`;
    })
    .join("\n\n");

  const prompt = `당신은 PKM(개인 지식 관리) 전문가입니다.
현재 문서와 관련 문서들을 분석하여, 각 관련 문서가 왜 관련되는지 구체적으로 설명해주세요.

## 현재 문서: ${currentName}
${currentBody}

---

${relatedContext}

---

## 지시사항
위 관련 문서들에 대해 Obsidian [[wikilink]] 형태로 관련 노트 섹션을 생성하세요.

규칙:
1. 각 항목은 "- [[문서명]] — 관련 이유" 형태로 작성
2. 관련 이유는 1~2문장으로, 구체적이고 맥락적으로 작성 (단순히 "관련있다"가 아니라 어떤 내용이 어떻게 연결되는지)
3. 현재 문서의 관점에서 작성 ("이 문서에서 다루는 X가 Y와 연결된다")
4. 한국어로 작성
5. 섹션 헤더(## 관련 노트)는 포함하지 마세요. 목록 항목만 출력하세요.
6. 유사도가 낮은 문서(0.4 미만)는 관련성이 약하다면 제외해도 됩니다.

출력 예시:
- [[PoC_KSNET]] — 이 문서에서 다루는 결제 플로우가 PoC_KSNET의 SCOPE 온체인 결제 구조와 동일한 아키텍처를 사용함
- [[SCOPE_프로토콜_분석]] — 이 문서의 3장 "토큰 전송 흐름"이 SCOPE 프로토콜의 트랜잭션 처리 방식을 상세 설명하는 자료`;

  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  // 텍스트 블록 추출
  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  const generatedLinks = textBlocks.map((b) => b.text).join("\n").trim();

  // 섹션 헤더 포함하여 반환
  return `${RELATED_SECTION_HEADER}\n${generatedLinks}\n`;
}

// ============================================
// 3. 관련 노트 섹션 삽입/교체
// ============================================

/**
 * 파일에 관련 노트 섹션을 추가하거나 기존 섹션을 교체한다.
 *
 * @param filePath - 대상 파일 경로
 * @param relatedSection - 삽입할 관련 노트 섹션 (헤더 포함)
 */
export async function appendRelatedSection(
  filePath: string,
  relatedSection: string,
): Promise<void> {
  let content: string;

  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch (error) {
    console.error(`[Linker] 파일 읽기 실패: ${filePath}`, error);
    throw error;
  }

  let updatedContent: string;

  if (content.includes(RELATED_SECTION_HEADER)) {
    // 기존 "## 관련 노트" 섹션을 교체
    updatedContent = content.replace(RELATED_SECTION_REGEX, relatedSection.trimEnd());
  } else {
    // 파일 끝에 추가 (빈 줄 보장)
    const trimmedContent = content.trimEnd();
    updatedContent = `${trimmedContent}\n\n${relatedSection}`;
  }

  await fs.writeFile(filePath, updatedContent, "utf-8");
  console.log(`[Linker] 관련 노트 섹션 업데이트: ${filePath}`);
}

// ============================================
// 4. 백링크 추가
// ============================================

/**
 * 대상 파일들에 소스 문서로의 백링크를 추가한다.
 * 이미 백링크가 존재하면 건너뜀.
 *
 * @param sourceFile - 백링크 소스 문서 경로
 * @param targetFiles - 백링크를 추가할 대상 파일 경로 배열
 */
export async function addBacklinks(
  sourceFile: string,
  targetFiles: string[],
): Promise<void> {
  const sourceName = extractDocName(sourceFile);
  const backlinkEntry = `- [[${sourceName}]]`;

  for (const targetFile of targetFiles) {
    try {
      let content: string;
      try {
        content = await fs.readFile(targetFile, "utf-8");
      } catch {
        // 파일이 존재하지 않으면 건너뜀
        console.warn(`[Linker] 백링크 대상 파일 없음: ${targetFile}`);
        continue;
      }

      // 이미 해당 소스로의 백링크가 있으면 건너뜀
      const wikilinkPattern = `[[${sourceName}]]`;
      if (content.includes(wikilinkPattern)) {
        console.log(`[Linker] 백링크 이미 존재: ${targetFile} → ${sourceName}`);
        continue;
      }

      if (content.includes(RELATED_SECTION_HEADER)) {
        // 기존 관련 노트 섹션에 백링크 항목 추가
        const sectionMatch = content.match(RELATED_SECTION_REGEX);
        if (sectionMatch) {
          const existingSection = sectionMatch[0];
          const updatedSection = `${existingSection.trimEnd()}\n${backlinkEntry}`;
          const updatedContent = content.replace(existingSection, updatedSection);
          await fs.writeFile(targetFile, updatedContent, "utf-8");
        }
      } else {
        // 관련 노트 섹션이 없으면 새로 생성하여 추가
        const trimmedContent = content.trimEnd();
        const newSection = `\n\n${RELATED_SECTION_HEADER}\n${backlinkEntry}\n`;
        await fs.writeFile(targetFile, trimmedContent + newSection, "utf-8");
      }

      console.log(`[Linker] 백링크 추가: ${targetFile} ← ${sourceName}`);
    } catch (error) {
      console.error(`[Linker] 백링크 추가 실패: ${targetFile}`, error);
      // 개별 파일 실패는 전체 프로세스를 중단하지 않음
    }
  }
}

// ============================================
// 5. 메인 오케스트레이터
// ============================================

/**
 * 관련 노트 링킹 전체 프로세스를 실행한다.
 *
 * 1. 벡터 검색으로 관련 노트 찾기
 * 2. 관련 노트 내용 읽기
 * 3. Claude로 컨텍스트 링크 생성
 * 4. 현재 문서에 관련 노트 섹션 추가
 * 5. 관련 노트들에 백링크 추가
 *
 * @param filePath - 현재 문서 경로
 * @param content - 현재 문서 내용
 * @returns 링크된 노트 이름 배열
 */
export async function linkRelatedNotes(
  filePath: string,
  content: string,
): Promise<string[]> {
  console.log(`[Linker] 관련 노트 링킹 시작: ${filePath}`);

  // 1단계: 관련 노트 검색
  const relatedNotes = await findRelatedNotes(filePath, content);

  if (relatedNotes.length === 0) {
    console.log(`[Linker] 관련 노트 없음: ${filePath}`);
    return [];
  }

  console.log(
    `[Linker] ${relatedNotes.length}개 관련 노트 발견:`,
    relatedNotes.map((n) => `${n.name}(${n.score.toFixed(3)})`).join(", "),
  );

  // 2단계: 관련 노트 내용 읽기
  const relatedDocs: Array<{ path: string; content: string; score: number }> = [];

  for (const note of relatedNotes) {
    try {
      const noteContent = await fs.readFile(note.path, "utf-8");
      relatedDocs.push({
        path: note.path,
        content: noteContent,
        score: note.score,
      });
    } catch {
      // 파일 읽기 실패 시 검색 결과의 텍스트를 대체 사용
      relatedDocs.push({
        path: note.path,
        content: note.content,
        score: note.score,
      });
    }
  }

  // 3단계: Claude로 컨텍스트 링크 생성
  const relatedSection = await generateContextLinks(
    { path: filePath, content },
    relatedDocs,
  );

  // 4단계: 현재 문서에 관련 노트 섹션 추가
  await appendRelatedSection(filePath, relatedSection);

  // 5단계: 관련 노트들에 백링크 추가
  const targetFiles = relatedDocs.map((d) => d.path);
  await addBacklinks(filePath, targetFiles);

  // 링크된 노트 이름 반환
  const linkedNames = relatedDocs.map((d) => extractDocName(d.path));
  console.log(`[Linker] 링킹 완료: ${linkedNames.join(", ")}`);

  return linkedNames;
}
