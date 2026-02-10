/**
 * PKM 초기화 모듈
 *
 * PARA 폴더 구조 생성, .obsidian 기본 설정, 온보딩 메시지 생성
 */

import * as fs from "fs/promises";
import * as path from "path";
import { PKM } from "../config/constants.js";
import { getWorkspacePath } from "../workspace/paths.js";

// ============================================
// 경로 유틸리티
// ============================================

export function getPkmRoot(): string {
  return path.join(getWorkspacePath(), "pkm");
}

export function getInboxPath(): string {
  return path.join(getPkmRoot(), "_Inbox");
}

export function getAssetsPath(): string {
  return path.join(getPkmRoot(), "_Assets");
}

export function getProjectsPath(): string {
  return path.join(getPkmRoot(), "1_Project");
}

export function getAreaPath(): string {
  return path.join(getPkmRoot(), "2_Area");
}

export function getResourcePath(): string {
  return path.join(getPkmRoot(), "3_Resource");
}

export function getArchivePath(): string {
  return path.join(getPkmRoot(), "4_Archive");
}

export function getParaPath(para: string): string {
  switch (para) {
    case "project": return getProjectsPath();
    case "area": return getAreaPath();
    case "resource": return getResourcePath();
    case "archive": return getArchivePath();
    default: return getInboxPath();
  }
}

// ============================================
// 초기화
// ============================================

/**
 * PARA 폴더 구조를 생성한다.
 * 이미 존재하면 건너뜀.
 */
export async function initPkmFolders(): Promise<void> {
  const root = getPkmRoot();

  const dirs = [
    root,
    getInboxPath(),
    getAssetsPath(),
    getProjectsPath(),
    getAreaPath(),
    getResourcePath(),
    getArchivePath(),
  ];

  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }

  // .obsidian 기본 설정
  await initObsidianConfig();

  console.log("[PKM] PARA 폴더 구조 초기화 완료");
}

/**
 * Obsidian vault 기본 설정을 생성한다.
 */
async function initObsidianConfig(): Promise<void> {
  const obsidianDir = path.join(getPkmRoot(), ".obsidian");
  await fs.mkdir(obsidianDir, { recursive: true });

  const appConfigPath = path.join(obsidianDir, "app.json");

  try {
    await fs.access(appConfigPath);
    // 이미 존재하면 건너뜀
  } catch {
    const appConfig = {
      attachmentFolderPath: "_Assets",
      newFileLocation: "folder",
      newFileFolderPath: "_Inbox",
      alwaysUpdateLinks: true,
      showFrontmatter: true,
    };

    await fs.writeFile(appConfigPath, JSON.stringify(appConfig, null, 2));
  }
}

/**
 * PKM이 초기화되었는지 확인한다.
 */
export async function isPkmInitialized(): Promise<boolean> {
  try {
    await fs.access(getPkmRoot());
    await fs.access(getInboxPath());
    await fs.access(getProjectsPath());
    return true;
  } catch {
    return false;
  }
}

// ============================================
// 프로젝트 생성
// ============================================

/**
 * 프로젝트 폴더와 인덱스 노트를 생성한다.
 */
export async function createProject(name: string, description?: string): Promise<string> {
  const projectDir = path.join(getProjectsPath(), name);
  const assetsDir = path.join(projectDir, "_Assets");

  await fs.mkdir(projectDir, { recursive: true });
  await fs.mkdir(assetsDir, { recursive: true });

  const indexPath = path.join(projectDir, `${name}.md`);

  try {
    await fs.access(indexPath);
    // 이미 존재하면 건너뜀
    return indexPath;
  } catch {
    // 인덱스 노트 생성
    const today = new Date().toISOString().split("T")[0];
    const content = `---
para: project
tags: []
created: ${today}
status: active
summary: "${description || ""}"
source: original
project: ${name}
---

## 목적

${description || ""}

## 관련 노트
`;

    await fs.writeFile(indexPath, content);
    console.log(`[PKM] 프로젝트 생성: ${name}`);
    return indexPath;
  }
}

/**
 * 여러 프로젝트를 일괄 생성한다.
 */
export async function createProjectsBatch(names: string[]): Promise<string[]> {
  const paths: string[] = [];
  for (const name of names) {
    const p = await createProject(name.trim());
    paths.push(p);
  }
  return paths;
}

// ============================================
// 온보딩 메시지
// ============================================

export const ONBOARDING_MESSAGES = {
  intro: "📂 문서 관리 기능을 켤까요?\n파일을 보내주시면 자동으로 분류하고 정리해드려요.",

  projectGuide: `📂 프로젝트를 먼저 만들어두면,
나중에 파일을 쏟아부을 때 제가 자동으로
관련 프로젝트 폴더에 넣어드릴 수 있어요.

프로젝트가 없으면 전부 '참고자료'나 '영역'으로만
분류되니까, 지금 진행 중인 일들을
프로젝트로 만들어두는 게 좋아요.

지금 진행 중인 프로젝트 이름을 알려주세요!
여러 개면 쉼표로 구분해주세요.
(예: PoC_KSNET, FLAP_Phase2, PKM_Bot)`,

  ready: "좋아요! 이제 파일을 쏟아주시면 정리할게요 ✨\n\n텔레그램으로 파일을 보내거나, 아래 폴더에 직접 넣어도 돼요:\n",

  disabled: "알겠어요! 나중에 필요하시면 말씀해주세요.",
} as const;

/**
 * 활성 프로젝트 목록을 반환한다.
 */
export async function listProjects(): Promise<Array<{ name: string; indexPath: string }>> {
  const projectsDir = getProjectsPath();

  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    const projects: Array<{ name: string; indexPath: string }> = [];

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("_")) {
        const indexPath = path.join(projectsDir, entry.name, `${entry.name}.md`);
        projects.push({ name: entry.name, indexPath });
      }
    }

    return projects;
  } catch {
    return [];
  }
}

/**
 * 프로젝트 컨텍스트(분류기에 전달할 요약)를 생성한다.
 */
export async function getProjectContext(): Promise<string> {
  const projects = await listProjects();
  if (projects.length === 0) return "활성 프로젝트 없음";

  const lines: string[] = [];
  for (const proj of projects) {
    try {
      const content = await fs.readFile(proj.indexPath, "utf-8");
      // frontmatter에서 summary와 tags 추출
      const summaryMatch = content.match(/summary:\s*"?([^"\n]+)"?/);
      const tagsMatch = content.match(/tags:\s*\[([^\]]*)\]/);
      const summary = summaryMatch?.[1] || "";
      const tags = tagsMatch?.[1] || "";
      lines.push(`- ${proj.name}: ${summary} [${tags}]`);
    } catch {
      lines.push(`- ${proj.name}`);
    }
  }

  return lines.join("\n");
}
