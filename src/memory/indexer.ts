/**
 * 메모리 인덱서 모듈
 * 현재 구현은 vectorStore가 on-demand로 로드하므로 캐시 무효화만 수행
 */

import { invalidateCache } from './vectorStore.js';

// 단일 파일 인덱싱 (캐시 무효화)
export async function indexFile(_filePath: string, _source: string): Promise<number> {
  // vectorStore가 on-demand로 로드하므로 캐시만 무효화
  invalidateCache();
  return 1;
}

// MEMORY.md 인덱싱
export async function indexMainMemory(): Promise<number> {
  invalidateCache();
  return 1;
}

// 일일 메모리 파일들 인덱싱
export async function indexDailyMemories(_days: number = 30): Promise<number> {
  invalidateCache();
  return 1;
}

// 전체 리인덱싱
export async function reindexAll(): Promise<{ main: number; daily: number }> {
  console.log('[Indexer] Invalidating cache for reindex...');
  invalidateCache();
  // vectorStore가 다음 검색 시 자동으로 다시 로드함
  return { main: 1, daily: 1 };
}
