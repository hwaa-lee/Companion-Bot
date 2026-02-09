// Memory module exports
export { embed, embedBatch, cosineSimilarity } from './embeddings.js';
export { search, invalidateCache } from './vectorStore.js';
export type { MemoryChunk, SearchResult } from './vectorStore.js';
export { indexFile, indexMainMemory, indexDailyMemories, reindexAll } from './indexer.js';
