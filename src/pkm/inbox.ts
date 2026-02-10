/**
 * 인박스 처리 오케스트레이터
 *
 * _Inbox/ 스캔 → 텍스트 추출 → 분류 → frontmatter 생성 → 파일 이동 → 인덱싱 → 링크 → 결과 리포트
 */

import * as fs from "fs/promises";
import * as path from "path";
import { getInboxPath, getParaPath, getProjectsPath, getProjectContext, getExistingSubfolders } from "./init.js";
import { extract, isBinaryFile } from "./extract.js";
import { classifyFiles, type ClassifyInput, type ClassifyResult } from "./classifier.js";
import { createDefault, stringify, inject, parse, type Frontmatter } from "./frontmatter.js";
import { linkRelatedNotes } from "./linker.js";

// ============================================
// 타입 정의
// ============================================

export interface InboxResult {
  total: number;
  classified: number;
  failed: number;
  byPara: Record<string, number>;
  details: Array<{
    fileName: string;
    para: string;
    targetPath: string;
    tags: string[];
    error?: string;
  }>;
}

// ============================================
// 메인 함수
// ============================================

/**
 * 인박스의 모든 파일을 처리한다.
 */
export async function processInbox(): Promise<InboxResult> {
  const inboxPath = getInboxPath();
  const result: InboxResult = {
    total: 0,
    classified: 0,
    failed: 0,
    byPara: { project: 0, area: 0, resource: 0, archive: 0 },
    details: [],
  };

  // 인박스 스캔
  let files: string[];
  try {
    const entries = await fs.readdir(inboxPath, { withFileTypes: true });
    files = entries
      .filter(e => e.isFile() && !e.name.startsWith(".") && !e.name.startsWith("_"))
      .map(e => path.join(inboxPath, e.name));
  } catch {
    console.log("[PKM:Inbox] 인박스 폴더가 비어있거나 없습니다");
    return result;
  }

  if (files.length === 0) {
    console.log("[PKM:Inbox] 처리할 파일이 없습니다");
    return result;
  }

  result.total = files.length;
  console.log(`[PKM:Inbox] ${files.length}개 파일 처리 시작`);

  // 프로젝트 컨텍스트 + 기존 하위폴더 로드
  const [projectContext, existingSubfolders] = await Promise.all([
    getProjectContext(),
    getExistingSubfolders(),
  ]);

  // 파일 내용 추출
  const inputs: ClassifyInput[] = [];
  for (const filePath of files) {
    const content = await extractContent(filePath);
    inputs.push({
      filePath,
      fileName: path.basename(filePath),
      content,
    });
  }

  // 분류 실행
  let classifications: ClassifyResult[];
  try {
    classifications = await classifyFiles(inputs, projectContext, existingSubfolders);
  } catch (err) {
    console.error("[PKM:Inbox] 분류 실패:", err);
    result.failed = files.length;
    return result;
  }

  // 파일 이동 + frontmatter 생성
  for (const cls of classifications) {
    try {
      const targetPath = await moveAndTag(cls);
      result.classified++;
      result.byPara[cls.para] = (result.byPara[cls.para] || 0) + 1;
      result.details.push({
        fileName: cls.fileName,
        para: cls.para,
        targetPath,
        tags: cls.tags,
      });

      // 관련 노트 링크 (moveAndTag는 바이너리든 텍스트든 항상 .md 경로를 반환)
      try {
        const mdContent = await fs.readFile(targetPath, "utf-8").catch(() => "");
        if (mdContent) {
          await linkRelatedNotes(targetPath, mdContent);
        }
      } catch {
        // 링크 실패는 무시 (분류는 성공)
      }
    } catch (err) {
      result.failed++;
      result.details.push({
        fileName: cls.fileName,
        para: cls.para,
        targetPath: "",
        tags: cls.tags,
        error: String(err),
      });
    }
  }

  console.log(`[PKM:Inbox] 완료: ${result.classified}/${result.total} 분류, ${result.failed} 실패`);
  return result;
}

/**
 * 단일 파일을 처리한다 (텔레그램 파일 수신 시).
 */
export async function processSingleFile(filePath: string): Promise<InboxResult> {
  const result: InboxResult = {
    total: 1,
    classified: 0,
    failed: 0,
    byPara: {},
    details: [],
  };

  const [projectContext, existingSubfolders] = await Promise.all([
    getProjectContext(),
    getExistingSubfolders(),
  ]);
  const content = await extractContent(filePath);

  const input: ClassifyInput = {
    filePath,
    fileName: path.basename(filePath),
    content,
  };

  try {
    const classifications = await classifyFiles([input], projectContext, existingSubfolders);
    const cls = classifications[0];

    const targetPath = await moveAndTag(cls);
    result.classified = 1;
    result.byPara[cls.para] = 1;
    result.details.push({
      fileName: cls.fileName,
      para: cls.para,
      targetPath,
      tags: cls.tags,
    });

    // 관련 노트 링크 (moveAndTag는 항상 .md 경로를 반환)
    try {
      const mdContent = await fs.readFile(targetPath, "utf-8").catch(() => "");
      if (mdContent) {
        await linkRelatedNotes(targetPath, mdContent);
      }
    } catch {
      // 링크 실패 무시
    }
  } catch (err) {
    result.failed = 1;
    result.details.push({
      fileName: path.basename(filePath),
      para: "unknown",
      targetPath: "",
      tags: [],
      error: String(err),
    });
  }

  return result;
}

// ============================================
// 내부 함수
// ============================================

/**
 * 파일에서 텍스트 내용을 추출한다.
 */
async function extractContent(filePath: string): Promise<string> {
  if (isBinaryFile(filePath)) {
    const result = await extract(filePath);
    return result.text || `[바이너리 파일: ${result.file?.name}]`;
  }

  // 텍스트 파일
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content.slice(0, 5000); // 분류용으로 5000자 제한
  } catch {
    return `[읽기 실패: ${path.basename(filePath)}]`;
  }
}

/**
 * 분류 결과에 따라 파일을 이동하고 frontmatter를 생성한다.
 */
async function moveAndTag(cls: ClassifyResult): Promise<string> {
  const basePath = getParaPath(cls.para);
  let targetDir: string;

  if (cls.para === "project" && cls.project) {
    // 프로젝트 폴더로 이동
    targetDir = path.join(getProjectsPath(), cls.project);
  } else {
    // 2_Area, 3_Resource, 4_Archive는 하위폴더 자동 생성
    targetDir = path.join(basePath, cls.targetFolder);
  }

  await fs.mkdir(targetDir, { recursive: true });

  const fileName = path.basename(cls.filePath);
  let targetPath = path.join(targetDir, fileName);

  // 파일명 충돌 처리
  targetPath = await resolveConflict(targetPath);

  if (isBinaryFile(cls.filePath)) {
    // 바이너리: 파일 이동 + 동반 마크다운 생성
    const assetsDir = path.join(targetDir, "_Assets");
    await fs.mkdir(assetsDir, { recursive: true });
    const assetPath = path.join(assetsDir, fileName);
    const resolvedAssetPath = await resolveConflict(assetPath);
    await fs.rename(cls.filePath, resolvedAssetPath);

    // 동반 마크다운 생성
    const mdPath = path.join(targetDir, `${fileName}.md`);
    const extractResult = await extract(resolvedAssetPath);
    const fm = createDefault({
      para: cls.para,
      tags: cls.tags,
      summary: cls.summary,
      source: "import",
      project: cls.project,
      file: extractResult.file ? {
        name: extractResult.file.name,
        format: extractResult.file.format,
        size_kb: extractResult.file.size_kb,
      } : undefined,
    });

    const mdContent = stringify(fm) + "\n\n" + (extractResult.text || `파일: ${fileName}`) + "\n";
    await fs.writeFile(mdPath, mdContent);

    targetPath = mdPath;
  } else {
    // 텍스트/마크다운: frontmatter 주입 후 이동
    const content = await fs.readFile(cls.filePath, "utf-8");
    const fm = createDefault({
      para: cls.para,
      tags: cls.tags,
      summary: cls.summary,
      source: "import",
      project: cls.project,
    });

    const taggedContent = inject(content, fm);
    await fs.writeFile(targetPath, taggedContent);
    await fs.unlink(cls.filePath);
  }

  console.log(`[PKM:Inbox] ${fileName} → ${cls.para}/${cls.targetFolder}`);
  return targetPath;
}

/**
 * 파일명 충돌 시 번호를 붙인다.
 */
async function resolveConflict(filePath: string): Promise<string> {
  try {
    await fs.access(filePath);
  } catch {
    return filePath; // 충돌 없음
  }

  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  let counter = 2;

  while (true) {
    const newPath = path.join(dir, `${base}_${counter}${ext}`);
    try {
      await fs.access(newPath);
      counter++;
    } catch {
      return newPath;
    }
  }
}

// ============================================
// 결과 리포트 생성
// ============================================

/**
 * 텔레그램 알림용 리포트 문자열을 생성한다.
 */
export function formatReport(result: InboxResult): string {
  if (result.total === 0) {
    return "📂 인박스에 처리할 파일이 없습니다.";
  }

  const lines: string[] = [];
  lines.push(`📊 ${result.total}개 파일 정리 완료`);

  if (result.byPara.project) lines.push(`  • 1_Project: ${result.byPara.project}개`);
  if (result.byPara.area) lines.push(`  • 2_Area: ${result.byPara.area}개`);
  if (result.byPara.resource) lines.push(`  • 3_Resource: ${result.byPara.resource}개`);
  if (result.byPara.archive) lines.push(`  • 4_Archive: ${result.byPara.archive}개`);

  if (result.failed > 0) {
    lines.push(`  ⚠️ 실패: ${result.failed}개`);
  }

  // 상세 내역 (최대 10개)
  const shown = result.details.slice(0, 10);
  if (shown.length > 0) {
    lines.push("");
    for (const d of shown) {
      const tags = d.tags.length > 0 ? ` #${d.tags.join(" #")}` : "";
      if (d.error) {
        lines.push(`  ❌ ${d.fileName}: ${d.error}`);
      } else {
        lines.push(`  📄 ${d.fileName} → ${d.para}/${path.basename(path.dirname(d.targetPath))}${tags}`);
      }
    }

    if (result.details.length > 10) {
      lines.push(`  ... 외 ${result.details.length - 10}개`);
    }
  }

  return lines.join("\n");
}
