/**
 * 전역 상수 설정
 * 하드코딩된 매직 넘버들을 한 곳에서 관리
 */

// ============================================
// 세션 관련 설정
// ============================================
export const SESSION = {
  /** 최대 동시 세션 수 (LRU 정리) */
  MAX_SESSIONS: 100,
  
  /** 세션 TTL (밀리초) - 24시간 */
  TTL_MS: 24 * 60 * 60 * 1000,
  
  /** 메모리에 로드할 최대 히스토리 메시지 수 */
  MAX_HISTORY_LOAD: 50,
} as const;

// ============================================
// 토큰/컨텍스트 관련 설정
// ============================================
export const TOKENS = {
  /** Claude 최대 컨텍스트 토큰 */
  MAX_CONTEXT: 200000,
  
  /** 히스토리 토큰 한도 */
  MAX_HISTORY: 80000,
  
  /** 이 이상이면 자동 요약 시작 */
  SUMMARY_THRESHOLD: 50000,
  
  /** 핀 맥락 최대 토큰 */
  MAX_PINNED: 10000,
  
  /** 자동 압축 시작 비율 (0.50 = 50%) */
  COMPACTION_THRESHOLD: 0.50,
  
  /** compact 스킵 기준 토큰 */
  COMPACT_MIN_TOKENS: 5000,
} as const;

// ============================================
// 메시지 관련 설정
// ============================================
export const MESSAGES = {
  /** 트리밍 시 최소 유지할 최근 메시지 수 */
  MIN_RECENT: 6,
  
  /** compact 시 유지할 최근 메시지 수 */
  KEEP_ON_COMPACT: 4,
  
  /** 최대 요약 청크 수 */
  MAX_SUMMARY_CHUNKS: 3,
  
  /** 검색 기본 결과 수 */
  SEARCH_LIMIT: 10,
  
  /** 히스토리 로드 기본 limit */
  HISTORY_LOAD_LIMIT: 100,
} as const;

// ============================================
// 메모리/벡터 저장소 설정
// ============================================
export const MEMORY = {
  /** 벡터 캐시 TTL (밀리초) - 5분 */
  CACHE_TTL_MS: 5 * 60 * 1000,
  
  /** 최소 청크 길이 (이하는 무시) */
  MIN_CHUNK_LENGTH: 20,
  
  /** 최대 청크 길이 (초과 시 분할) */
  MAX_CHUNK_LENGTH: 500,
  
  /** 로드할 최근 메모리 파일 일수 */
  RECENT_DAYS: 30,
  
  /** 벡터 검색 기본 topK */
  SEARCH_TOP_K: 5,
  
  /** 벡터 검색 최소 유사도 점수 */
  MIN_SIMILARITY: 0.3,
  
  /** /memory 명령어 표시 일수 */
  DISPLAY_DAYS: 7,
  
  /** /memory 최대 표시 길이 */
  MAX_DISPLAY_LENGTH: 2000,
} as const;

// ============================================
// 텔레그램/UI 관련 설정
// ============================================
export const TELEGRAM = {
  /** 텔레그램 메시지 최대 길이 */
  MAX_MESSAGE_LENGTH: 4096,
  
  /** 최대 이미지 크기 (바이트) - 10MB */
  MAX_IMAGE_SIZE: 10 * 1024 * 1024,
  
  /** URL 처리 최대 개수 */
  MAX_URL_FETCH: 3,
  
  /** 캘린더 미리보기 이벤트 수 */
  CALENDAR_PREVIEW_COUNT: 3,
  
  /** Typing indicator 자동 갱신 간격 (밀리초) - 텔레그램은 5초 후 만료 */
  TYPING_REFRESH_MS: 4000,
} as const;

// ============================================
// 보안/토큰 관련 설정
// ============================================
export const SECURITY = {
  /** 리셋 토큰 만료 시간 (밀리초) - 1분 */
  RESET_TOKEN_TTL_MS: 60000,
} as const;

// ============================================
// API/네트워크 설정
// ============================================
export const API = {
  /** Claude API 타임아웃 (밀리초) - 2분 */
  TIMEOUT_MS: 120000,
  
  /** 최대 재시도 횟수 */
  MAX_RETRIES: 3,
  
  /** 초기 재시도 대기 시간 (밀리초) */
  INITIAL_RETRY_DELAY_MS: 1000,
  
  /** 최대 재시도 대기 시간 (밀리초) */
  MAX_RETRY_DELAY_MS: 30000,
  
  /** 재시도 백오프 배수 */
  BACKOFF_MULTIPLIER: 2,
} as const;

// ============================================
// 메모리 검색 타임아웃 설정
// ============================================
export const SEARCH = {
  /** 전체 검색 타임아웃 (밀리초) */
  TIMEOUT_MS: 5000,
  
  /** 임베딩 생성 타임아웃 (밀리초) */
  EMBED_TIMEOUT_MS: 3000,
} as const;
