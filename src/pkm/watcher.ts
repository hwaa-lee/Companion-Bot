/**
 * PKM _Inbox 폴더 감시 모듈
 *
 * _Inbox/ 폴더에 새 파일이 추가되면 콜백을 호출한다.
 * Node.js 내장 fs.watch만 사용 (외부 의존 없음).
 * 파일 복사 중 다중 이벤트 발생 대비 디바운스 처리.
 */

import { watch, existsSync, type FSWatcher } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import { PKM } from "../config/constants.js";

// ============================================
// 상태
// ============================================

let watcher: FSWatcher | null = null;

/** 파일별 디바운스 타이머 */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** 이미 처리된 파일 (중복 방지) */
const processedFiles = new Set<string>();

// ============================================
// 무시 규칙
// ============================================

/** 감시에서 무시할 파일인지 판별한다 */
function shouldIgnore(filename: string): boolean {
  // dotfile (.DS_Store, .gitkeep 등)
  if (filename.startsWith(".")) return true;

  // .obsidian 하위 변경
  if (filename.includes(".obsidian")) return true;

  // 임시 파일 패턴: ~, .tmp, .swp, .part, .crdownload 등
  if (filename.endsWith("~")) return true;
  if (filename.endsWith(".tmp")) return true;
  if (filename.endsWith(".swp")) return true;
  if (filename.endsWith(".swo")) return true;
  if (filename.endsWith(".part")) return true;
  if (filename.endsWith(".crdownload")) return true;

  // macOS 임시 파일
  if (filename.startsWith("._")) return true;

  // Thumbs.db (Windows)
  if (filename.toLowerCase() === "thumbs.db") return true;

  return false;
}

// ============================================
// 파일 안정성 확인
// ============================================

/**
 * 파일이 쓰기 완료되었는지 확인한다.
 * 크기가 변하지 않으면 안정된 것으로 간주.
 */
async function isFileStable(filePath: string): Promise<boolean> {
  try {
    const stat1 = await fs.stat(filePath);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const stat2 = await fs.stat(filePath);

    return stat1.size === stat2.size && stat1.mtimeMs === stat2.mtimeMs;
  } catch {
    // 파일이 사라졌거나 접근 불가
    return false;
  }
}

// ============================================
// 메인 API
// ============================================

/**
 * _Inbox 폴더 감시를 시작한다.
 *
 * @param inboxPath - 감시할 _Inbox 폴더 경로
 * @param onNewFile - 새 파일 감지 시 호출되는 콜백
 * @param debounceMs - 디바운스 시간 (기본: PKM.WATCHER_DEBOUNCE_MS 또는 2000ms)
 */
export function startWatcher(
  inboxPath: string,
  onNewFile: (filePath: string) => void,
  debounceMs?: number,
): void {
  // 이미 감시 중이면 먼저 정리
  if (watcher) {
    console.log("[PKM:Watcher] 기존 감시 중지 후 재시작");
    stopWatcher();
  }

  const delay = debounceMs ?? PKM.WATCHER_DEBOUNCE_MS ?? 2000;

  // 폴더 존재 여부 확인
  if (!existsSync(inboxPath)) {
    console.warn(
      `[PKM:Watcher] _Inbox 폴더가 존재하지 않습니다: ${inboxPath}`,
    );
    console.warn("[PKM:Watcher] 폴더가 생성되면 다시 시도해주세요.");
    return;
  }

  try {
    watcher = watch(inboxPath, { recursive: false }, (eventType, filename) => {
      // filename이 null일 수 있음 (일부 플랫폼)
      if (!filename) return;

      // 무시 대상 필터링
      if (shouldIgnore(filename)) return;

      const filePath = path.join(inboxPath, filename);

      // 기존 디바운스 타이머가 있으면 초기화
      const existingTimer = debounceTimers.get(filePath);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      // 디바운스: 일정 시간 후 파일 처리
      const timer = setTimeout(async () => {
        debounceTimers.delete(filePath);

        try {
          // 파일이 실제로 존재하는지 확인 (삭제 이벤트 필터링)
          const stat = await fs.stat(filePath);
          if (!stat.isFile()) return;

          // 파일 쓰기가 완료되었는지 확인
          const stable = await isFileStable(filePath);
          if (!stable) {
            console.log(
              `[PKM:Watcher] 파일이 아직 쓰기 중: ${filename}`,
            );
            return;
          }

          // 이미 처리된 파일 확인 (같은 세션 내 중복 방지)
          if (processedFiles.has(filePath)) return;
          processedFiles.add(filePath);

          console.log(`[PKM:Watcher] 새 파일 감지: ${filename}`);
          onNewFile(filePath);
        } catch (err) {
          // 파일이 삭제되었거나 접근 불가 - 무시
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            console.error(
              `[PKM:Watcher] 파일 처리 중 오류 (${filename}):`,
              err,
            );
          }
        }
      }, delay);

      debounceTimers.set(filePath, timer);
    });

    // 감시 오류 처리
    watcher.on("error", (err) => {
      console.error("[PKM:Watcher] 감시 오류:", err);

      // EPERM이나 EACCES면 감시 중지
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") {
        console.error("[PKM:Watcher] 권한 오류로 감시를 중지합니다");
        stopWatcher();
      }
    });

    console.log(`[PKM:Watcher] _Inbox 감시 시작: ${inboxPath}`);
    console.log(`[PKM:Watcher] 디바운스: ${delay}ms`);
  } catch (err) {
    console.error("[PKM:Watcher] 감시 시작 실패:", err);
    watcher = null;
  }
}

/**
 * _Inbox 폴더 감시를 중지한다.
 */
export function stopWatcher(): void {
  // 모든 디바운스 타이머 정리
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();

  // 처리 기록 초기화
  processedFiles.clear();

  // 감시 중지
  if (watcher) {
    watcher.close();
    watcher = null;
    console.log("[PKM:Watcher] 감시 중지");
  }
}

/**
 * 현재 감시 중인지 반환한다.
 */
export function isWatching(): boolean {
  return watcher !== null;
}

/**
 * 처리 완료된 파일 기록을 초기화한다.
 * 같은 파일을 재처리해야 할 때 사용.
 */
export function resetProcessedFiles(): void {
  processedFiles.clear();
  console.log("[PKM:Watcher] 처리 기록 초기화");
}
