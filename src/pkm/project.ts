/**
 * PKM 프로젝트 수명주기 관리 모듈
 *
 * 프로젝트 완료/복원/이름변경/조회/목록 기능을 제공한다.
 * PARA 구조의 1_Project/ ↔ 4_Archive/ 이동을 처리.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { getProjectsPath, getArchivePath } from "./init.js";
import { parse, stringify, type Frontmatter } from "./frontmatter.js";

// ============================================
// 타입 정의
// ============================================

export interface ProjectInfo {
  /** 프로젝트 이름 */
  name: string;
  /** 상태 (active, completed, on-hold 등) */
  status: string;
  /** 프로젝트 요약 설명 */
  summary: string;
  /** 태그 목록 */
  tags: string[];
  /** 프로젝트 폴더 내 파일 수 */
  fileCount: number;
  /** 생성일 (YYYY-MM-DD) */
  created: string;
}

// ============================================
// 프로젝트 완료 (1_Project → 4_Archive)
// ============================================

/**
 * 프로젝트를 완료 처리한다.
 * 1_Project/ 에서 4_Archive/ 로 이동하고 상태를 completed로 변경.
 *
 * @param name - 프로젝트 이름 (폴더명)
 * @returns 성공 메시지
 */
export async function completeProject(name: string): Promise<string> {
  const srcDir = path.join(getProjectsPath(), name);
  const destDir = path.join(getArchivePath(), name);

  // 프로젝트 폴더 존재 확인
  try {
    const stat = await fs.stat(srcDir);
    if (!stat.isDirectory()) {
      throw new Error(`${name}은(는) 디렉토리가 아닙니다`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `[PKM:Project] 프로젝트를 찾을 수 없습니다: ${name}\n` +
          `경로: ${srcDir}`,
      );
    }
    throw err;
  }

  // 아카이브에 동일 이름 존재 확인
  try {
    await fs.access(destDir);
    throw new Error(
      `[PKM:Project] 아카이브에 이미 같은 이름의 폴더가 있습니다: ${name}\n` +
        `경로: ${destDir}`,
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
    // ENOENT: 정상 - 아카이브에 없음
  }

  // 인덱스 파일의 frontmatter 상태 업데이트
  await updateIndexStatus(srcDir, name, "completed");

  // 폴더 이동
  await fs.rename(srcDir, destDir);

  const msg = `[PKM:Project] 프로젝트 완료: ${name} → 4_Archive/`;
  console.log(msg);
  return msg;
}

// ============================================
// 프로젝트 복원 (4_Archive → 1_Project)
// ============================================

/**
 * 아카이브된 프로젝트를 복원한다.
 * 4_Archive/ 에서 1_Project/ 로 이동하고 상태를 active로 변경.
 *
 * @param name - 프로젝트 이름 (폴더명)
 * @returns 성공 메시지
 */
export async function restoreProject(name: string): Promise<string> {
  const srcDir = path.join(getArchivePath(), name);
  const destDir = path.join(getProjectsPath(), name);

  // 아카이브에 프로젝트 존재 확인
  try {
    const stat = await fs.stat(srcDir);
    if (!stat.isDirectory()) {
      throw new Error(`${name}은(는) 디렉토리가 아닙니다`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `[PKM:Project] 아카이브에서 프로젝트를 찾을 수 없습니다: ${name}\n` +
          `경로: ${srcDir}`,
      );
    }
    throw err;
  }

  // 활성 프로젝트에 동일 이름 존재 확인
  try {
    await fs.access(destDir);
    throw new Error(
      `[PKM:Project] 이미 같은 이름의 활성 프로젝트가 있습니다: ${name}\n` +
        `경로: ${destDir}`,
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
    // ENOENT: 정상 - 활성 프로젝트에 없음
  }

  // 인덱스 파일의 frontmatter 상태 업데이트
  await updateIndexStatus(srcDir, name, "active");

  // 폴더 이동
  await fs.rename(srcDir, destDir);

  const msg = `[PKM:Project] 프로젝트 복원: ${name} → 1_Project/`;
  console.log(msg);
  return msg;
}

// ============================================
// 프로젝트 이름 변경
// ============================================

/**
 * 프로젝트 이름을 변경한다.
 * 폴더명, 인덱스 파일명, frontmatter의 project 필드를 모두 업데이트.
 *
 * @param oldName - 기존 프로젝트 이름
 * @param newName - 변경할 이름
 * @returns 변경된 프로젝트 경로
 */
export async function renameProject(
  oldName: string,
  newName: string,
): Promise<string> {
  const projectsDir = getProjectsPath();
  const oldDir = path.join(projectsDir, oldName);
  const newDir = path.join(projectsDir, newName);

  // 기존 프로젝트 확인
  try {
    const stat = await fs.stat(oldDir);
    if (!stat.isDirectory()) {
      throw new Error(`${oldName}은(는) 디렉토리가 아닙니다`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `[PKM:Project] 프로젝트를 찾을 수 없습니다: ${oldName}\n` +
          `경로: ${oldDir}`,
      );
    }
    throw err;
  }

  // 새 이름이 이미 사용 중인지 확인
  try {
    await fs.access(newDir);
    throw new Error(
      `[PKM:Project] 이미 같은 이름의 프로젝트가 있습니다: ${newName}\n` +
        `경로: ${newDir}`,
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  // 인덱스 파일 이름 변경 + frontmatter 업데이트
  const oldIndexPath = path.join(oldDir, `${oldName}.md`);
  const newIndexPath = path.join(oldDir, `${newName}.md`);

  try {
    await fs.access(oldIndexPath);

    // frontmatter에서 project 필드 업데이트
    const content = await fs.readFile(oldIndexPath, "utf-8");
    const { frontmatter, body } = parse(content);
    frontmatter.project = newName;
    const updated = stringify(frontmatter) + "\n" + body;
    await fs.writeFile(oldIndexPath, updated);

    // 인덱스 파일 이름 변경
    await fs.rename(oldIndexPath, newIndexPath);
  } catch (err) {
    // 인덱스 파일이 없어도 폴더 이름은 변경 가능
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
    console.warn(
      `[PKM:Project] 인덱스 파일 없음, 폴더만 이름 변경: ${oldName}`,
    );
  }

  // 폴더 이름 변경
  await fs.rename(oldDir, newDir);

  console.log(
    `[PKM:Project] 프로젝트 이름 변경: ${oldName} → ${newName}`,
  );
  return newDir;
}

// ============================================
// 프로젝트 정보 조회
// ============================================

/**
 * 프로젝트 상세 정보를 반환한다.
 * 인덱스 파일의 frontmatter와 폴더 내 파일 수를 포함.
 *
 * @param name - 프로젝트 이름
 * @returns 프로젝트 정보 객체
 */
export async function getProjectInfo(name: string): Promise<ProjectInfo> {
  const projectDir = path.join(getProjectsPath(), name);

  // 프로젝트 폴더 확인
  try {
    await fs.access(projectDir);
  } catch {
    throw new Error(
      `[PKM:Project] 프로젝트를 찾을 수 없습니다: ${name}\n` +
        `경로: ${projectDir}`,
    );
  }

  // 파일 수 세기 (재귀, 디렉토리 및 숨김 파일 제외)
  const fileCount = await countFiles(projectDir);

  // 인덱스 파일에서 frontmatter 읽기
  const indexPath = path.join(projectDir, `${name}.md`);
  let frontmatter: Frontmatter = {};

  try {
    const content = await fs.readFile(indexPath, "utf-8");
    ({ frontmatter } = parse(content));
  } catch {
    // 인덱스 파일이 없으면 기본값 사용
    console.warn(`[PKM:Project] 인덱스 파일 없음: ${indexPath}`);
  }

  return {
    name,
    status: String(frontmatter.status ?? "unknown"),
    summary: String(frontmatter.summary ?? ""),
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
    fileCount,
    created: String(frontmatter.created ?? ""),
  };
}

// ============================================
// 전체 프로젝트 목록
// ============================================

/**
 * 1_Project/ 내 모든 프로젝트의 기본 정보를 반환한다.
 *
 * @returns 프로젝트 정보 배열
 */
export async function listAllProjects(): Promise<ProjectInfo[]> {
  const projectsDir = getProjectsPath();
  const projects: ProjectInfo[] = [];

  // 폴더 존재 확인
  try {
    await fs.access(projectsDir);
  } catch {
    console.warn(
      `[PKM:Project] 프로젝트 폴더가 없습니다: ${projectsDir}`,
    );
    return [];
  }

  // 디렉토리 엔트리 읽기
  let entries;
  try {
    entries = await fs.readdir(projectsDir, { withFileTypes: true });
  } catch (err) {
    console.error("[PKM:Project] 프로젝트 목록 읽기 실패:", err);
    return [];
  }

  const dirNames = entries
    .filter(e => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("_"))
    .map(e => e.name);

  const results = await Promise.allSettled(
    dirNames.map(name => getProjectInfo(name))
  );

  for (const [idx, result] of results.entries()) {
    if (result.status === "fulfilled") {
      projects.push(result.value);
    } else {
      console.warn(
        `[PKM:Project] 프로젝트 정보 읽기 실패 (${dirNames[idx]}):`,
        result.reason,
      );
    }
  }

  return projects;
}

// ============================================
// 프로젝트 삭제
// ============================================

/**
 * 프로젝트를 삭제한다 (1_Project/ 또는 4_Archive/ 에서).
 * 폴더와 모든 내용이 영구 삭제된다.
 *
 * @param name - 프로젝트 이름 (폴더명)
 * @returns 성공 메시지
 */
export async function deleteProject(name: string): Promise<string> {
  // 1_Project에서 먼저 찾기
  let targetDir = path.join(getProjectsPath(), name);
  let location = "1_Project";

  try {
    const stat = await fs.stat(targetDir);
    if (!stat.isDirectory()) throw new Error("not a directory");
  } catch {
    // 4_Archive에서 찾기
    targetDir = path.join(getArchivePath(), name);
    location = "4_Archive";

    try {
      const stat = await fs.stat(targetDir);
      if (!stat.isDirectory()) {
        throw new Error(`${name}은(는) 디렉토리가 아닙니다`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `[PKM:Project] 프로젝트를 찾을 수 없습니다: ${name}\n` +
            `1_Project/ 와 4_Archive/ 모두 확인했습니다.`,
        );
      }
      throw err;
    }
  }

  await fs.rm(targetDir, { recursive: true, force: true });

  const msg = `[PKM:Project] 프로젝트 삭제: ${name} (${location}/)`;
  console.log(msg);
  return msg;
}

// ============================================
// 내부 유틸리티
// ============================================

/**
 * 인덱스 파일의 frontmatter status를 업데이트한다.
 * 인덱스 파일이 없으면 경고만 출력하고 넘어감.
 */
async function updateIndexStatus(
  projectDir: string,
  name: string,
  status: string,
): Promise<void> {
  const indexPath = path.join(projectDir, `${name}.md`);

  try {
    const content = await fs.readFile(indexPath, "utf-8");
    const { frontmatter, body } = parse(content);
    frontmatter.status = status as Frontmatter["status"];
    const updated = stringify(frontmatter) + "\n" + body;
    await fs.writeFile(indexPath, updated);
    console.log(
      `[PKM:Project] 인덱스 상태 업데이트: ${name} → ${status}`,
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.warn(
        `[PKM:Project] 인덱스 파일 없음, 상태 업데이트 생략: ${indexPath}`,
      );
    } else {
      throw err;
    }
  }
}

/**
 * 디렉토리 내 파일 수를 재귀적으로 센다.
 * 숨김 파일과 디렉토리는 제외.
 */
async function countFiles(dirPath: string): Promise<number> {
  let count = 0;

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // 숨김 파일/폴더 제외
      if (entry.name.startsWith(".")) continue;

      if (entry.isFile()) {
        count++;
      } else if (entry.isDirectory()) {
        // 재귀 탐색
        count += await countFiles(path.join(dirPath, entry.name));
      }
    }
  } catch {
    // 디렉토리 읽기 실패 시 0 반환
  }

  return count;
}
