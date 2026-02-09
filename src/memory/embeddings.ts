/**
 * 로컬 임베딩 생성 모듈
 * @xenova/transformers를 사용하여 텍스트 임베딩을 생성합니다.
 */

import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";

// 싱글톤 파이프라인
let embeddingPipeline: FeatureExtractionPipeline | null = null;

// 모델 로딩 중인지 추적
let isLoading = false;
let loadingPromise: Promise<FeatureExtractionPipeline> | null = null;

/**
 * 임베딩 파이프라인을 초기화합니다.
 * 작고 빠른 모델 사용 (384 차원)
 */
async function getEmbeddingPipeline(): Promise<FeatureExtractionPipeline> {
  if (embeddingPipeline) {
    return embeddingPipeline;
  }

  // 이미 로딩 중이면 기다림
  if (isLoading && loadingPromise) {
    return loadingPromise;
  }

  isLoading = true;
  loadingPromise = pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2" // 384차원, 빠르고 가벼움
  );

  try {
    embeddingPipeline = await loadingPromise;
    return embeddingPipeline;
  } finally {
    isLoading = false;
  }
}

/**
 * 텍스트를 임베딩 벡터로 변환합니다.
 * @param text 변환할 텍스트
 * @returns 384차원 임베딩 벡터
 */
export async function embed(text: string): Promise<number[]> {
  const pipe = await getEmbeddingPipeline();
  
  // 텍스트 정규화
  const cleanText = text.trim().slice(0, 512); // 최대 512자
  if (!cleanText) {
    return new Array(384).fill(0);
  }

  const result = await pipe(cleanText, {
    pooling: "mean",
    normalize: true,
  });

  // Tensor를 배열로 변환
  return Array.from(result.data as Float32Array);
}

/**
 * 여러 텍스트를 배치로 임베딩합니다.
 * @param texts 변환할 텍스트 배열
 * @returns 임베딩 벡터 배열
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (const text of texts) {
    results.push(await embed(text));
  }
  return results;
}

/**
 * 두 벡터 간의 코사인 유사도를 계산합니다.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  
  return dotProduct / denominator;
}
