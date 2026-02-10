/**
 * PKM 모듈 통합 export
 */

// 초기화 + 경로
export {
  getPkmRoot,
  getInboxPath,
  getAssetsPath,
  getProjectsPath,
  getAreaPath,
  getResourcePath,
  getArchivePath,
  getParaPath,
  initPkmFolders,
  isPkmInitialized,
  createProject,
  createProjectsBatch,
  listProjects,
  getProjectContext,
  ONBOARDING_MESSAGES,
} from "./init.js";

// frontmatter
export {
  parse as parseFrontmatter,
  stringify as stringifyFrontmatter,
  inject as injectFrontmatter,
  createDefault as createDefaultFrontmatter,
  type Frontmatter,
  type ParaCategory,
  type NoteStatus,
  type NoteSource,
  type FileMetadata,
} from "./frontmatter.js";

// 바이너리 추출
export {
  extract as extractBinary,
  isBinaryFile,
  companionMdPath,
  type ExtractResult,
} from "./extract.js";

// 분류기
export {
  classifyFiles,
  type ClassifyInput,
  type ClassifyResult,
} from "./classifier.js";

// 인박스 처리
export {
  processInbox,
  processSingleFile,
  formatReport,
  type InboxResult,
} from "./inbox.js";

// 관련 노트 링커
export {
  linkRelatedNotes,
} from "./linker.js";

// 파일 감시
export {
  startWatcher,
  stopWatcher,
} from "./watcher.js";

// 프로젝트 관리
export {
  completeProject,
  restoreProject,
  renameProject,
  getProjectInfo,
  listAllProjects,
} from "./project.js";
