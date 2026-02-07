import { loadWorkspace, type Workspace } from "../../workspace/index.js";

// 워크스페이스 캐시
let cachedWorkspace: Workspace | null = null;
let workspaceCacheTime = 0;
let loadingPromise: Promise<Workspace> | null = null;
const CACHE_TTL = 300000; // 5분

/**
 * 캐시된 워크스페이스를 반환합니다.
 * 캐시가 만료되었거나 없으면 새로 로드합니다.
 */
export async function getWorkspace(): Promise<Workspace> {
  const now = Date.now();

  // 캐시가 유효하면 바로 반환
  if (cachedWorkspace && now - workspaceCacheTime <= CACHE_TTL) {
    return cachedWorkspace;
  }

  // 이미 로딩 중이면 해당 Promise 반환 (중복 호출 방지)
  if (loadingPromise) {
    return loadingPromise;
  }

  // 새로 로드
  loadingPromise = loadWorkspace();
  try {
    cachedWorkspace = await loadingPromise;
    workspaceCacheTime = Date.now();
    return cachedWorkspace;
  } finally {
    loadingPromise = null;
  }
}

/**
 * 워크스페이스 캐시를 무효화합니다.
 */
export function invalidateWorkspaceCache(): void {
  cachedWorkspace = null;
  workspaceCacheTime = 0;
  loadingPromise = null;
}
