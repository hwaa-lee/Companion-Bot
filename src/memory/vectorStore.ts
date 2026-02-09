/**
 * 간단한 벡터 저장소 모듈
 * 메모리 파일들을 로드하고 유사도 기반으로 검색합니다.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { getMemoryDirPath, getWorkspaceFilePath } from "../workspace/paths.js";
import { embed, cosineSimilarity } from "./embeddings.js";

export interface MemoryChunk {
  text: string;
  source: string;
  embedding?: number[];
}

export interface SearchResult {
  text: string;
  source: string;
  score: number;
}

// 캐시된 청크들 (임베딩 포함)
let cachedChunks: MemoryChunk[] = [];
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5분

/**
 * 텍스트를 적절한 크기의 청크로 분할합니다.
 */
function splitIntoChunks(text: string, source: string): MemoryChunk[] {
  const chunks: MemoryChunk[] = [];
  
  // ## 헤더로 분할 (메모리 파일 형식)
  const sections = text.split(/(?=^## )/m);
  
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed || trimmed.length < 20) continue;
    
    // 청크가 너무 길면 추가로 분할
    if (trimmed.length > 500) {
      const lines = trimmed.split("\n");
      let currentChunk = "";
      
      for (const line of lines) {
        if (currentChunk.length + line.length > 500) {
          if (currentChunk.trim()) {
            chunks.push({ text: currentChunk.trim(), source });
          }
          currentChunk = line;
        } else {
          currentChunk += "\n" + line;
        }
      }
      
      if (currentChunk.trim()) {
        chunks.push({ text: currentChunk.trim(), source });
      }
    } else {
      chunks.push({ text: trimmed, source });
    }
  }
  
  return chunks;
}

/**
 * 모든 메모리 파일을 로드하고 청크로 분할합니다.
 */
async function loadAllMemoryChunks(): Promise<MemoryChunk[]> {
  const now = Date.now();
  
  // 캐시가 유효하면 반환
  if (cachedChunks.length > 0 && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedChunks;
  }

  const chunks: MemoryChunk[] = [];

  // 1. 일별 메모리 파일 (최근 30일)
  const memoryDir = getMemoryDirPath();
  try {
    const files = await fs.readdir(memoryDir);
    const mdFiles = files.filter(f => f.endsWith(".md")).sort().reverse().slice(0, 30);
    
    for (const file of mdFiles) {
      try {
        const content = await fs.readFile(path.join(memoryDir, file), "utf-8");
        const fileChunks = splitIntoChunks(content, file.replace(".md", ""));
        chunks.push(...fileChunks);
      } catch {
        // 파일 읽기 실패 무시
      }
    }
  } catch {
    // 디렉토리 없음 무시
  }

  // 2. MEMORY.md (장기 기억)
  try {
    const memoryMdPath = getWorkspaceFilePath("MEMORY.md");
    const content = await fs.readFile(memoryMdPath, "utf-8");
    const memoryChunks = splitIntoChunks(content, "MEMORY");
    chunks.push(...memoryChunks);
  } catch {
    // 파일 없음 무시
  }

  // 캐시 업데이트 (임베딩은 아직 없음)
  cachedChunks = chunks;
  cacheTimestamp = now;

  return chunks;
}

/**
 * 쿼리 임베딩으로 관련 메모리를 검색합니다.
 * @param queryEmbedding 검색 쿼리의 임베딩 벡터
 * @param topK 반환할 최대 결과 수
 * @param minScore 최소 유사도 점수 (0-1)
 */
export async function search(
  queryEmbedding: number[],
  topK: number = 3,
  minScore: number = 0.4
): Promise<SearchResult[]> {
  const chunks = await loadAllMemoryChunks();
  
  if (chunks.length === 0) {
    return [];
  }

  // 각 청크에 대해 임베딩 생성 및 유사도 계산
  const results: SearchResult[] = [];
  
  for (const chunk of chunks) {
    try {
      // 캐시된 임베딩이 없으면 생성
      if (!chunk.embedding) {
        chunk.embedding = await embed(chunk.text);
      }
      
      const score = cosineSimilarity(queryEmbedding, chunk.embedding);
      
      if (score >= minScore) {
        results.push({
          text: chunk.text,
          source: chunk.source,
          score,
        });
      }
    } catch {
      // 임베딩 실패 무시
    }
  }

  // 유사도 점수로 정렬하고 상위 K개 반환
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * 캐시를 무효화합니다.
 */
export function invalidateCache(): void {
  cachedChunks = [];
  cacheTimestamp = 0;
}

// 영속적 저장소용 인터페이스
export interface VectorEntry {
  id: string;
  text: string;
  embedding: number[];
  source: string;
  timestamp: number;
}

// 인메모리 저장소 (간단한 구현)
let vectorStore: VectorEntry[] = [];

/**
 * 엔트리들을 저장소에 추가/업데이트합니다.
 */
export async function upsertEntries(entries: VectorEntry[]): Promise<void> {
  for (const entry of entries) {
    const existingIndex = vectorStore.findIndex(e => e.id === entry.id);
    if (existingIndex >= 0) {
      vectorStore[existingIndex] = entry;
    } else {
      vectorStore.push(entry);
    }
  }
  
  // 캐시 무효화
  invalidateCache();
}

/**
 * 특정 소스의 모든 엔트리를 삭제합니다.
 */
export async function deleteBySource(source: string): Promise<number> {
  const before = vectorStore.length;
  vectorStore = vectorStore.filter(e => e.source !== source);
  const deleted = before - vectorStore.length;
  
  if (deleted > 0) {
    invalidateCache();
  }
  
  return deleted;
}

/**
 * 저장소의 모든 엔트리를 반환합니다.
 */
export function getAllEntries(): VectorEntry[] {
  return [...vectorStore];
}
