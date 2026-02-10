/**
 * 메모리 인덱서 모듈
 * 벡터 저장소와 FTS 인덱스 모두 업데이트합니다.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { invalidateCache, loadAllMemoryChunks } from "./vectorStore.js";
import { indexTextBatch, clearIndex as clearFtsIndex, getDocumentCount, type FtsEntry } from "./ftsIndex.js";
import { getMemoryDirPath, getWorkspaceFilePath } from "../workspace/paths.js";
import { MEMORY } from "../config/constants.js";

/**
 * 텍스트를 청크로 분할합니다.
 */
function splitIntoChunks(text: string, source: string): Array<{ id: string; text: string; source: string }> {
  const chunks: Array<{ id: string; text: string; source: string }> = [];
  let chunkIndex = 0;

  // ## 헤더로 분할
  const sections = text.split(/(?=^## )/m);

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed || trimmed.length < MEMORY.MIN_CHUNK_LENGTH) continue;

    // 청크가 너무 길면 추가로 분할
    if (trimmed.length > MEMORY.MAX_CHUNK_LENGTH) {
      const lines = trimmed.split("\n");
      let currentChunk = "";

      for (const line of lines) {
        if (currentChunk.length + line.length > MEMORY.MAX_CHUNK_LENGTH) {
          if (currentChunk.trim()) {
            chunks.push({
              id: `${source}:${chunkIndex++}`,
              text: currentChunk.trim(),
              source,
            });
          }
          currentChunk = line;
        } else {
          currentChunk += "\n" + line;
        }
      }

      if (currentChunk.trim()) {
        chunks.push({
          id: `${source}:${chunkIndex++}`,
          text: currentChunk.trim(),
          source,
        });
      }
    } else {
      chunks.push({
        id: `${source}:${chunkIndex++}`,
        text: trimmed,
        source,
      });
    }
  }

  return chunks;
}

/**
 * 단일 파일 인덱싱 (캐시 무효화 + FTS 업데이트)
 */
export async function indexFile(filePath: string, source: string): Promise<number> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const chunks = splitIntoChunks(content, source);

    // FTS 인덱스 업데이트
    const ftsEntries: FtsEntry[] = chunks.map(c => ({
      id: c.id,
      source: c.source,
      text: c.text,
    }));
    indexTextBatch(ftsEntries);

    // 벡터 캐시 무효화
    invalidateCache();

    return chunks.length;
  } catch {
    return 0;
  }
}

/**
 * MEMORY.md 인덱싱
 */
export async function indexMainMemory(): Promise<number> {
  const memoryPath = getWorkspaceFilePath("MEMORY.md");
  return indexFile(memoryPath, "MEMORY");
}

/**
 * 일일 메모리 파일들 인덱싱
 */
export async function indexDailyMemories(days: number = MEMORY.RECENT_DAYS): Promise<number> {
  const memoryDir = getMemoryDirPath();
  let totalChunks = 0;

  try {
    const files = await fs.readdir(memoryDir);
    const mdFiles = files
      .filter(f => f.endsWith(".md") && !f.startsWith("."))
      .sort()
      .reverse()
      .slice(0, days);

    for (const file of mdFiles) {
      const filePath = path.join(memoryDir, file);
      const source = file.replace(".md", "");
      const count = await indexFile(filePath, source);
      totalChunks += count;
    }
  } catch {
    // 디렉토리 없음 무시
  }

  return totalChunks;
}

/**
 * 대화 기록 인덱싱 (JSONL 형식)
 */
export async function indexConversation(
  conversationId: string,
  messages: Array<{ role: string; content: string; timestamp?: number }>
): Promise<number> {
  if (messages.length === 0) return 0;

  const ftsEntries: FtsEntry[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg.content || msg.content.length < 10) continue;

    ftsEntries.push({
      id: `conv:${conversationId}:${i}`,
      source: `conversation:${conversationId}`,
      text: `[${msg.role}] ${msg.content}`,
    });
  }

  if (ftsEntries.length > 0) {
    indexTextBatch(ftsEntries);
  }

  return ftsEntries.length;
}

/**
 * PKM 문서 인덱싱
 * PARA 폴더 내 마크다운 파일들을 FTS에 인덱싱한다.
 */
export async function indexPkmDocuments(): Promise<number> {
  let totalChunks = 0;

  try {
    // 동적 import (PKM 미사용 시 로드 안 함)
    const { getPkmRoot, isPkmInitialized } = await import("../pkm/init.js");

    const initialized = await isPkmInitialized();
    if (!initialized) return 0;

    const pkmRoot = getPkmRoot();
    const paraFolders = ["1_Project", "2_Area", "3_Resource", "4_Archive"];

    for (const folder of paraFolders) {
      const folderPath = path.join(pkmRoot, folder);
      try {
        totalChunks += await indexPkmFolder(folderPath, `pkm:${folder}`);
      } catch {
        // 폴더 없음 무시
      }
    }

    console.log(`[Indexer] PKM indexed: ${totalChunks} chunks`);
  } catch {
    // PKM 모듈 없으면 무시
  }

  return totalChunks;
}

/**
 * PKM 폴더 재귀 인덱싱 (마크다운만)
 * source에 실제 파일 경로를 저장하여 검색 결과에서 경로 확인 가능
 */
async function indexPkmFolder(dirPath: string, _sourcePrefix: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("_")) {
      total += await indexPkmFolder(fullPath, `${_sourcePrefix}/${entry.name}`);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      // source = "pkm:<파일절대경로>" → 검색 결과에서 파일 경로 직접 확인 가능
      const source = `pkm:${fullPath}`;
      total += await indexFile(fullPath, source);
    }
  }

  return total;
}

/**
 * 전체 리인덱싱 (벡터 + FTS 모두)
 */
export async function reindexAll(): Promise<{ total: number; sources: string[]; ftsCount: number }> {
  console.log("[Indexer] Starting full reindex...");

  // 1. FTS 인덱스 초기화
  clearFtsIndex();

  // 2. 벡터 캐시 무효화 및 로드
  invalidateCache();
  const chunks = await loadAllMemoryChunks();

  // 3. 모든 청크를 FTS에 인덱싱
  const ftsEntries: FtsEntry[] = chunks.map((chunk, idx) => ({
    id: `${chunk.source}:${idx}`,
    source: chunk.source,
    text: chunk.text,
  }));

  if (ftsEntries.length > 0) {
    indexTextBatch(ftsEntries);
  }

  // 4. 소스별 집계
  const sourceCounts = new Map<string, number>();
  for (const chunk of chunks) {
    sourceCounts.set(chunk.source, (sourceCounts.get(chunk.source) || 0) + 1);
  }

  // 5. PKM 문서 인덱싱
  const pkmChunks = await indexPkmDocuments();
  const totalWithPkm = chunks.length + pkmChunks;

  const ftsCount = getDocumentCount();
  console.log(`[Indexer] Indexed ${totalWithPkm} chunks (${pkmChunks} from PKM), ${ftsCount} documents to FTS`);

  return {
    total: totalWithPkm,
    sources: Array.from(sourceCounts.keys()),
    ftsCount,
  };
}
