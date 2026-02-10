/**
 * 2단계 문서 분류기
 *
 * Stage 1: Haiku로 빠른 배치 분류 (파일명 + 미리보기 200자)
 * Stage 2: Sonnet으로 정밀 분류 (신뢰도 낮은 파일만, 전체 본문)
 *
 * PARA 방법론 기반:
 *   project  - 마감, 체크리스트, 액션 아이템, 활성 프로젝트 관련
 *   area     - 유지보수, 모니터링, 운영, 지속적 책임
 *   resource - 분석, 가이드, 레퍼런스, 하우투
 *   archive  - 완료, 오래됨, 더 이상 활성이 아닌 콘텐츠
 */

import Anthropic from "@anthropic-ai/sdk";
import { PKM } from "../config/constants.js";
import type { ParaCategory } from "./frontmatter.js";

// ============================================
// 모델 상수
// ============================================

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const SONNET_MODEL = "claude-sonnet-4-5-20250929";

// Stage 1 미리보기 길이 (바이트가 아닌 문자 수)
const PREVIEW_LENGTH = 200;

// ============================================
// 타입 정의
// ============================================

/** 분류기 입력 */
export interface ClassifyInput {
  filePath: string;
  content: string;
  fileName: string;
}

/** 최종 분류 결과 */
export interface ClassifyResult {
  filePath: string;
  fileName: string;
  para: ParaCategory;
  tags: string[];
  summary: string;
  targetFolder: string;
  project?: string;
  confidence: number;
}

/** Stage 1 응답 (파일 1개분) */
interface Stage1Item {
  fileName: string;
  para: ParaCategory;
  tags: string[];
  confidence: number;
  project?: string;
  targetFolder?: string;
}

/** Stage 2 응답 */
interface Stage2Item {
  para: ParaCategory;
  tags: string[];
  summary: string;
  targetFolder: string;
  project?: string;
}

// ============================================
// Anthropic 클라이언트 (싱글턴)
// ============================================

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

// ============================================
// 프롬프트 템플릿 (한국어)
// ============================================

/** Stage 1: 빠른 배치 분류 프롬프트 */
function buildStage1Prompt(
  files: Array<{ fileName: string; preview: string }>,
  projectContext: string,
): string {
  const fileList = files
    .map((f, i) => `[${i}] 파일명: ${f.fileName}\n미리보기: ${f.preview}`)
    .join("\n\n");

  return `당신은 PARA 방법론 기반 문서 분류 전문가입니다.

## 활성 프로젝트 목록
${projectContext}

## 분류 규칙
- project: 마감일, 체크리스트, 액션 아이템이 있거나, 위 활성 프로젝트와 직접 관련된 문서
- area: 유지보수, 모니터링, 운영, 지속적 책임 영역의 문서
- resource: 분석 자료, 가이드, 레퍼런스, 하우투, 학습 자료
- archive: 완료된 작업, 오래된 내용, 더 이상 활성이 아닌 문서

## 분류할 파일 목록
${fileList}

## 응답 형식
반드시 아래 JSON 배열만 출력하세요. 설명이나 마크다운 코드블록 없이 순수 JSON만 반환합니다.
[
  {
    "fileName": "파일명",
    "para": "project" | "area" | "resource" | "archive",
    "tags": ["태그1", "태그2"],
    "confidence": 0.0~1.0,
    "project": "프로젝트명 (project일 때만, 아니면 생략)",
    "targetFolder": "하위 폴더명 (예: DevOps, 회의록, 건강관리 등. 최상위에 놓으려면 빈 문자열)"
  }
]

각 파일에 대해 정확히 하나의 객체를 반환하세요. tags는 최대 5개, 한국어 또는 영어 혼용 가능합니다.
confidence는 분류 확신도입니다 (0.0=모름, 1.0=확실).
targetFolder는 PARA 폴더 아래의 하위 폴더명입니다. PARA 접두사(1_Project 등)를 포함하지 마세요.`;
}

/** Stage 2: 정밀 분류 프롬프트 */
function buildStage2Prompt(
  fileName: string,
  content: string,
  projectContext: string,
): string {
  return `당신은 PARA 방법론 기반 문서 분류 전문가입니다. 이 문서를 정밀하게 분석해주세요.

## 활성 프로젝트 목록
${projectContext}

## 분류 규칙
- project: 마감일, 체크리스트, 액션 아이템이 있거나, 위 활성 프로젝트와 직접 관련된 문서. 반드시 관련 프로젝트명을 project 필드에 기재.
- area: 유지보수, 모니터링, 운영, 지속적 책임 영역의 문서 (예: 건강관리, 재무, 팀 운영)
- resource: 분석 자료, 가이드, 레퍼런스, 하우투, 학습 자료 (예: 기술 문서, 독서 노트)
- archive: 완료된 작업, 오래된 내용, 더 이상 활성이 아닌 문서

## 대상 파일
파일명: ${fileName}

## 전체 내용
${content}

## 응답 형식
반드시 아래 JSON 객체만 출력하세요. 설명이나 마크다운 코드블록 없이 순수 JSON만 반환합니다.
{
  "para": "project" | "area" | "resource" | "archive",
  "tags": ["태그1", "태그2", ...],
  "summary": "문서 내용을 2~3문장으로 요약",
  "targetFolder": "하위 폴더명 (예: DevOps, 회의록). PARA 접두사 포함하지 말 것",
  "project": "관련 프로젝트명 (project일 때만, 아니면 생략)"
}

tags는 최대 5개, summary는 한국어로 작성하세요.
targetFolder는 PARA 폴더(1_Project, 2_Area, 3_Resource, 4_Archive) 아래의 하위 폴더명입니다. PARA 접두사(1_Project, 2_Area, 3_Resource, 4_Archive)를 포함하지 마세요. 예: "DevOps", "회의록" (O) / "3_Resource/DevOps" (X)`;
}

// ============================================
// Stage 1: Haiku 배치 분류
// ============================================

/**
 * Haiku로 파일 배치를 빠르게 분류한다.
 * 파일명 + 본문 미리보기(200자)만 사용하여 비용과 속도를 최적화.
 */
async function classifyBatchStage1(
  files: ClassifyInput[],
  projectContext: string,
): Promise<Map<string, Stage1Item>> {
  const anthropic = getClient();
  const results = new Map<string, Stage1Item>();

  // 미리보기 데이터 준비
  const previews = files.map((f) => ({
    fileName: f.fileName,
    preview: f.content.slice(0, PREVIEW_LENGTH),
  }));

  const prompt = buildStage1Prompt(previews, projectContext);

  try {
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    // 텍스트 블록에서 JSON 추출
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    const parsed = parseJsonSafe<Stage1Item[]>(text);

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        // 유효성 검증: para 값이 올바른지 확인
        if (isValidPara(item.para) && item.fileName) {
          results.set(item.fileName, {
            fileName: item.fileName,
            para: item.para,
            tags: Array.isArray(item.tags) ? item.tags.slice(0, 5) : [],
            confidence: clampConfidence(item.confidence),
            project: item.project || undefined,
            targetFolder: typeof item.targetFolder === "string" ? stripParaPrefix(item.targetFolder) : undefined,
          });
        }
      }
    }
  } catch (error) {
    // API 오류 시 모든 파일을 낮은 신뢰도로 기본 분류
    console.error("[Classifier] Stage 1 배치 분류 실패:", error);
    for (const file of files) {
      results.set(file.fileName, {
        fileName: file.fileName,
        para: "resource",
        tags: [],
        confidence: 0,
        project: undefined,
      });
    }
  }

  return results;
}

// ============================================
// Stage 2: Sonnet 정밀 분류
// ============================================

/**
 * Sonnet으로 개별 파일을 정밀 분류한다.
 * 전체 본문 + 프로젝트 컨텍스트를 활용하여 정확한 분류를 수행.
 */
async function classifySingleStage2(
  file: ClassifyInput,
  projectContext: string,
): Promise<Stage2Item> {
  const anthropic = getClient();
  const prompt = buildStage2Prompt(file.fileName, file.content, projectContext);

  // 기본값 (API 실패 시 폴백)
  const fallback: Stage2Item = {
    para: "resource",
    tags: [],
    summary: "",
    targetFolder: "",
    project: undefined,
  };

  try {
    const response = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    const parsed = parseJsonSafe<Stage2Item>(text);

    if (parsed && isValidPara(parsed.para)) {
      // AI가 targetFolder 또는 legacy targetPath를 반환할 수 있음
      const rawFolder = typeof parsed.targetFolder === "string"
        ? parsed.targetFolder
        : typeof (parsed as any).targetPath === "string"
          ? (parsed as any).targetPath
          : "";
      return {
        para: parsed.para,
        tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5) : [],
        summary: typeof parsed.summary === "string" ? parsed.summary : "",
        targetFolder: stripParaPrefix(rawFolder),
        project: parsed.project || undefined,
      };
    }
  } catch (error) {
    console.error(`[Classifier] Stage 2 정밀 분류 실패 (${file.fileName}):`, error);
  }

  return fallback;
}

// ============================================
// 메인 함수
// ============================================

/**
 * 파일 목록을 2단계로 분류한다.
 *
 * 1단계: Haiku로 배치 분류 (BATCH_SIZE 단위)
 * 2단계: 신뢰도가 CONFIDENCE_THRESHOLD 미만인 파일을 Sonnet으로 재분류
 *
 * @param files - 분류할 파일 배열
 * @param projectContext - 활성 프로젝트 목록 (설명 포함)
 * @returns 모든 파일의 최종 분류 결과
 */
export async function classifyFiles(
  files: ClassifyInput[],
  projectContext: string,
): Promise<ClassifyResult[]> {
  if (files.length === 0) return [];

  const batchSize = PKM.BATCH_SIZE;
  const confidenceThreshold = PKM.CONFIDENCE_THRESHOLD;

  console.log(`[Classifier] 분류 시작: ${files.length}개 파일, 배치 크기=${batchSize}, 임계값=${confidenceThreshold}`);

  // ── Stage 1: Haiku 배치 분류 ──
  const stage1Results = new Map<string, Stage1Item>();
  const batches = chunkArray(files, batchSize);

  for (let i = 0; i < batches.length; i++) {
    console.log(`[Classifier] Stage 1 배치 ${i + 1}/${batches.length} (${batches[i].length}개 파일)`);
    const batchResults = await classifyBatchStage1(batches[i], projectContext);

    // 결과 병합
    for (const [key, value] of batchResults) {
      stage1Results.set(key, value);
    }
  }

  // ── Stage 2: 낮은 신뢰도 파일 재분류 ──
  const uncertainFiles = files.filter((f) => {
    const s1 = stage1Results.get(f.fileName);
    return !s1 || s1.confidence < confidenceThreshold;
  });

  const stage2Results = new Map<string, Stage2Item>();

  if (uncertainFiles.length > 0) {
    console.log(`[Classifier] Stage 2 정밀 분류: ${uncertainFiles.length}개 파일 (신뢰도 < ${confidenceThreshold})`);

    // Stage 2는 개별 호출 (전체 본문 전달)
    for (const file of uncertainFiles) {
      console.log(`[Classifier] Stage 2 분류 중: ${file.fileName}`);
      const result = await classifySingleStage2(file, projectContext);
      stage2Results.set(file.fileName, result);
    }
  }

  // ── 최종 결과 조합 ──
  const finalResults: ClassifyResult[] = files.map((file) => {
    const s2 = stage2Results.get(file.fileName);
    const s1 = stage1Results.get(file.fileName);

    // Stage 2 결과가 있으면 우선 사용
    if (s2) {
      return {
        filePath: file.filePath,
        fileName: file.fileName,
        para: s2.para,
        tags: s2.tags,
        summary: s2.summary,
        targetFolder: s2.targetFolder,
        project: s2.project,
        confidence: 1.0, // Stage 2를 거쳤으므로 높은 신뢰도
      };
    }

    // Stage 1 결과 사용 (신뢰도 충분)
    if (s1) {
      return {
        filePath: file.filePath,
        fileName: file.fileName,
        para: s1.para,
        tags: s1.tags,
        summary: "", // Stage 1에서는 요약 미제공
        targetFolder: stripParaPrefix(s1.targetFolder || ""),
        project: s1.project,
        confidence: s1.confidence,
      };
    }

    // 둘 다 없는 경우 (이론상 발생하지 않음) 기본값
    return {
      filePath: file.filePath,
      fileName: file.fileName,
      para: "resource" as ParaCategory,
      tags: [],
      summary: "",
      targetFolder: "3_Resource",
      confidence: 0,
    };
  });

  console.log(`[Classifier] 분류 완료: ${finalResults.length}개 파일`);
  return finalResults;
}

// ============================================
// 유틸리티
// ============================================

/** 배열을 chunkSize 크기의 배열들로 나눈다 */
function chunkArray<T>(arr: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    chunks.push(arr.slice(i, i + chunkSize));
  }
  return chunks;
}

/** PARA 카테고리를 폴더 경로로 변환한다 */
function paraToFolder(para: ParaCategory): string {
  switch (para) {
    case "project":
      return "1_Project";
    case "area":
      return "2_Area";
    case "resource":
      return "3_Resource";
    case "archive":
      return "4_Archive";
  }
}

/**
 * AI 응답에서 PARA 접두사(1_Project, 2_Area 등)를 제거한다.
 * "3_Resource/DevOps" → "DevOps", "DevOps" → "DevOps", "" → ""
 */
function stripParaPrefix(folder: string): string {
  const trimmed = folder.trim();
  // PARA 접두사 패턴: "1_Project/", "2_Area/", "3_Resource/", "4_Archive/"
  const stripped = trimmed.replace(/^[1-4]_(?:Project|Area|Resource|Archive)\/?/i, "");
  return stripped;
}

/** 유효한 PARA 카테고리인지 확인한다 */
function isValidPara(value: unknown): value is ParaCategory {
  return (
    value === "project" ||
    value === "area" ||
    value === "resource" ||
    value === "archive"
  );
}

/** confidence 값을 0~1 범위로 클램핑한다 */
function clampConfidence(value: unknown): number {
  const num = typeof value === "number" ? value : 0;
  return Math.max(0, Math.min(1, num));
}

/**
 * JSON 문자열을 안전하게 파싱한다.
 * LLM 응답에 포함될 수 있는 마크다운 코드블록을 제거한 후 파싱.
 */
function parseJsonSafe<T>(text: string): T | null {
  try {
    // 마크다운 코드블록 제거 (```json ... ``` 또는 ``` ... ```)
    const cleaned = text
      .replace(/^```(?:json)?\s*\n?/m, "")
      .replace(/\n?```\s*$/m, "")
      .trim();

    return JSON.parse(cleaned) as T;
  } catch {
    // 첫 번째 [ 또는 { 부터 마지막 ] 또는 } 까지 추출 시도
    const jsonMatch = text.match(/[\[{][\s\S]*[\]}]/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as T;
      } catch {
        console.error("[Classifier] JSON 파싱 실패:", text.slice(0, 200));
        return null;
      }
    }
    console.error("[Classifier] JSON 추출 실패:", text.slice(0, 200));
    return null;
  }
}
