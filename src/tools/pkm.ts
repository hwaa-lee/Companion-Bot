/**
 * PKM 도구 실행기
 *
 * 인박스 처리, PKM 검색, 프로젝트 관리 도구 실행 함수들
 */

import * as fs from "fs/promises";
import * as path from "path";
import {
  processInbox,
  processSingleFile,
  formatReport,
  initPkmFolders,
  isPkmInitialized,
  createProject,
  createProjectsBatch,
  listProjects,
  getProjectContext,
  startWatcher,
  stopWatcher,
  completeProject,
  restoreProject,
  renameProject,
  deleteProject,
  getProjectInfo,
  listAllProjects,
  getPkmRoot,
  getInboxPath,
} from "../pkm/index.js";
import { hybridSearch } from "../memory/hybridSearch.js";
import { indexPkmDocuments } from "../memory/indexer.js";

// ============================================
// pkm_inbox - 인박스 처리
// ============================================

export async function executePkmInbox(input: Record<string, unknown>): Promise<string> {
  const initialized = await isPkmInitialized();
  if (!initialized) {
    return "PKM이 아직 초기화되지 않았어요. 먼저 pkm_init 도구를 사용해주세요.";
  }

  const filePath = input.file as string | undefined;

  if (filePath) {
    // 단일 파일 처리
    const result = await processSingleFile(filePath);
    return formatReport(result);
  }

  // 전체 인박스 처리
  const result = await processInbox();

  // 인덱싱 갱신
  if (result.classified > 0) {
    try {
      await indexPkmDocuments();
    } catch {
      // 인덱싱 실패는 무시
    }
  }

  return formatReport(result);
}

// ============================================
// pkm_search - PKM 문서 검색
// ============================================

export async function executePkmSearch(input: Record<string, unknown>): Promise<string> {
  const query = input.query as string;
  const limit = (input.limit as number) || 5;

  // PKM 소스 필터는 post-filter로 처리 (DB 소스명이 "pkm:<경로>" 형태)
  const rawResults = await hybridSearch(query, {
    topK: limit * 3, // post-filter 여유분
    useTrigram: true,
  });

  // "pkm:" 접두사로 PKM 문서만 필터링
  const results = rawResults
    .filter(r => r.source.startsWith("pkm:"))
    .slice(0, limit);

  if (results.length === 0) {
    return "관련 문서를 찾지 못했어요.";
  }

  const lines: string[] = [`🔍 "${query}" 검색 결과 (${results.length}건)`, ""];

  for (const [i, r] of results.entries()) {
    const filePath = r.source.replace(/^pkm:/, "");
    const preview = r.text.slice(0, 200).replace(/\n/g, " ");
    lines.push(`[${i + 1}] ${filePath} (score: ${r.score.toFixed(2)})`);
    lines.push(`  ${preview}${r.text.length > 200 ? "..." : ""}`);
    lines.push("");
  }

  lines.push("💡 원본 전체를 보려면 위 경로로 read_file 도구를 사용해주세요.");

  return lines.join("\n");
}

// ============================================
// pkm_project - 프로젝트 관리
// ============================================

export async function executePkmProject(input: Record<string, unknown>): Promise<string> {
  const action = input.action as string;

  switch (action) {
    case "create": {
      const name = input.name as string;
      const description = input.description as string | undefined;
      if (!name) return "프로젝트 이름을 입력해주세요.";

      // 쉼표 구분 다수 생성
      if (name.includes(",")) {
        const names = name.split(",").map(n => n.trim()).filter(Boolean);
        const paths = await createProjectsBatch(names);
        return `✅ ${paths.length}개 프로젝트 생성 완료:\n${names.map(n => `  • ${n}`).join("\n")}`;
      }

      const indexPath = await createProject(name, description);
      return `✅ 프로젝트 "${name}" 생성 완료\n경로: ${indexPath}`;
    }

    case "list": {
      const projects = await listAllProjects();
      if (projects.length === 0) return "활성 프로젝트가 없어요.";

      const lines = ["📂 프로젝트 목록", ""];
      for (const p of projects) {
        lines.push(`• ${p.name} (${p.status}) - ${p.summary || "설명 없음"}`);
        lines.push(`  파일: ${p.fileCount}개, 태그: ${p.tags.join(", ") || "없음"}`);
      }
      return lines.join("\n");
    }

    case "complete": {
      const name = input.name as string;
      if (!name) return "프로젝트 이름을 입력해주세요.";
      await completeProject(name);
      return `✅ "${name}" 프로젝트가 완료 처리되어 4_Archive로 이동했어요.`;
    }

    case "restore": {
      const name = input.name as string;
      if (!name) return "프로젝트 이름을 입력해주세요.";
      await restoreProject(name);
      return `✅ "${name}" 프로젝트가 복원되어 1_Project로 돌아왔어요.`;
    }

    case "rename": {
      const oldName = input.name as string;
      const newName = input.new_name as string;
      if (!oldName || !newName) return "기존 이름(name)과 새 이름(new_name)을 모두 입력해주세요.";
      await renameProject(oldName, newName);
      return `✅ "${oldName}" → "${newName}" 이름 변경 완료`;
    }

    case "delete": {
      const name = input.name as string;
      if (!name) return "프로젝트 이름을 입력해주세요.";
      await deleteProject(name);
      return `🗑️ "${name}" 프로젝트가 삭제되었어요. (폴더와 모든 내용이 영구 삭제됨)`;
    }

    case "info": {
      const name = input.name as string;
      if (!name) return "프로젝트 이름을 입력해주세요.";
      const info = await getProjectInfo(name);
      return [
        `📋 ${info.name}`,
        `상태: ${info.status}`,
        `설명: ${info.summary || "없음"}`,
        `태그: ${info.tags.join(", ") || "없음"}`,
        `파일: ${info.fileCount}개`,
        `생성일: ${info.created}`,
      ].join("\n");
    }

    default:
      return `알 수 없는 액션: ${action}\n사용 가능: create, list, complete, restore, rename, delete, info`;
  }
}

// ============================================
// pkm_init - PKM 초기화
// ============================================

export async function executePkmInit(_input: Record<string, unknown>): Promise<string> {
  const already = await isPkmInitialized();
  if (already) {
    const projects = await listProjects();
    return `PKM이 이미 초기화되어 있어요.\n경로: ${getPkmRoot()}\n활성 프로젝트: ${projects.length}개`;
  }

  await initPkmFolders();
  return [
    "✅ PKM 폴더 구조 생성 완료!",
    "",
    `경로: ${getPkmRoot()}`,
    "  _Inbox/    - 파일을 여기에 넣으세요",
    "  1_Project/ - 프로젝트",
    "  2_Area/    - 영역 (지속 관리)",
    "  3_Resource/ - 참고 자료",
    "  4_Archive/ - 보관함",
    "",
    "💡 먼저 프로젝트를 만들어두면 분류가 더 정확해요.",
    "   pkm_project(action='create', name='프로젝트명') 으로 만들 수 있어요.",
  ].join("\n");
}

// ============================================
// pkm_watcher - 감시 제어
// ============================================

export async function executePkmWatcher(input: Record<string, unknown>): Promise<string> {
  const action = input.action as string;

  switch (action) {
    case "start": {
      const callback = async (filePath: string) => {
        try {
          await processSingleFile(filePath);
        } catch (err) {
          console.error("[PKM:Watcher] 파일 처리 실패:", err);
        }
      };
      startWatcher(getInboxPath(), callback);
      return "✅ _Inbox/ 폴더 감시를 시작했어요. 파일을 넣으면 자동으로 분류합니다.";
    }

    case "stop": {
      stopWatcher();
      return "✅ _Inbox/ 폴더 감시를 중지했어요.";
    }

    default:
      return `알 수 없는 액션: ${action}\n사용 가능: start, stop`;
  }
}
