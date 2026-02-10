/**
 * YAML frontmatter 파싱/생성/주입 모듈
 *
 * 마크다운 파일의 YAML frontmatter를 읽고 쓴다.
 * AI-PKM 호환 스키마: para, tags, created, status, summary, source, project, file
 */

// ============================================
// 타입 정의
// ============================================

export type ParaCategory = "project" | "area" | "resource" | "archive";
export type NoteStatus = "active" | "draft" | "completed" | "on-hold";
export type NoteSource = "original" | "meeting" | "literature" | "import";

export interface FileMetadata {
  name: string;
  format: string;
  size_kb: number;
}

export interface Frontmatter {
  para?: ParaCategory;
  tags?: string[];
  created?: string;       // YYYY-MM-DD
  status?: NoteStatus;
  summary?: string;
  source?: NoteSource;
  project?: string;       // para가 project일 때
  file?: FileMetadata;    // 바이너리 동반 파일일 때
  [key: string]: unknown; // 사용자 커스텀 필드 허용
}

// ============================================
// 파싱
// ============================================

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * 마크다운에서 frontmatter를 파싱한다.
 * 빈 frontmatter이면 빈 객체 반환.
 */
export function parse(markdown: string): { frontmatter: Frontmatter; body: string } {
  const match = markdown.match(FRONTMATTER_REGEX);

  if (!match) {
    return { frontmatter: {}, body: markdown };
  }

  const yamlStr = match[1];
  const body = markdown.slice(match[0].length);
  const frontmatter = parseYamlSimple(yamlStr);

  return { frontmatter, body };
}

/**
 * 간단한 YAML 파서 (js-yaml 의존 없이 frontmatter 수준만)
 * 지원: 문자열, 배열(인라인+멀티라인), 중첩 객체 1단계
 */
function parseYamlSimple(yamlStr: string): Frontmatter {
  const result: Frontmatter = {};
  const lines = yamlStr.split("\n");
  let currentKey = "";
  let currentObj: Record<string, unknown> | null = null;

  for (const line of lines) {
    const trimmed = line.trimEnd();

    // 빈 줄 무시
    if (!trimmed) continue;

    // 배열 항목 (- value)
    const arrayItemMatch = trimmed.match(/^  - (.+)$/);
    if (arrayItemMatch && currentKey) {
      const arr = result[currentKey];
      if (Array.isArray(arr)) {
        arr.push(arrayItemMatch[1].trim());
      }
      continue;
    }

    // 중첩 객체 속성 (  key: value)
    const nestedMatch = trimmed.match(/^  (\w+):\s*(.+)$/);
    if (nestedMatch && currentObj) {
      const val = parseValue(nestedMatch[2]);
      currentObj[nestedMatch[1]] = val;
      continue;
    }

    // 최상위 키: 값
    const kvMatch = trimmed.match(/^(\w+):\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      currentObj = null;
      const rawValue = kvMatch[2].trim();

      if (!rawValue) {
        // 값이 없으면 다음 줄에서 배열이나 객체일 수 있음
        // 일단 빈 값 세팅, 아래에서 덮어씀
        result[currentKey] = undefined;
        continue;
      }

      // 인라인 배열 [a, b, c]
      const inlineArrayMatch = rawValue.match(/^\[(.+)\]$/);
      if (inlineArrayMatch) {
        result[currentKey] = inlineArrayMatch[1]
          .split(",")
          .map(s => s.trim().replace(/^['"]|['"]$/g, ""));
        continue;
      }

      result[currentKey] = parseValue(rawValue);
      continue;
    }

    // 들여쓰기된 줄인데 중첩 객체 시작
    if (trimmed.match(/^  \w+:/) && currentKey && result[currentKey] === undefined) {
      currentObj = {};
      result[currentKey] = currentObj;
      const nestedKv = trimmed.match(/^  (\w+):\s*(.+)$/);
      if (nestedKv) {
        currentObj[nestedKv[1]] = parseValue(nestedKv[2]);
      }
    }
  }

  return result;
}

function parseValue(raw: string): string | number | boolean {
  // 따옴표 제거
  if ((raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  // 숫자
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return Number(raw);
  }
  // 불리언
  if (raw === "true") return true;
  if (raw === "false") return false;

  return raw;
}

// ============================================
// 생성
// ============================================

/**
 * Frontmatter 객체를 YAML 문자열로 변환한다.
 */
export function stringify(fm: Frontmatter): string {
  const lines: string[] = ["---"];

  // 순서 보장: para, tags, created, status, summary, source, project, file, 나머지
  const orderedKeys = ["para", "tags", "created", "status", "summary", "source", "project", "file"];
  const allKeys = new Set([...orderedKeys, ...Object.keys(fm)]);

  for (const key of allKeys) {
    const value = fm[key];
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(", ")}]`);
    } else if (typeof value === "object") {
      lines.push(`${key}:`);
      for (const [k, v] of Object.entries(value)) {
        if (v !== undefined && v !== null) {
          lines.push(`  ${k}: ${v}`);
        }
      }
    } else if (typeof value === "string" && value.includes(":")) {
      lines.push(`${key}: "${value}"`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }

  lines.push("---");
  return lines.join("\n");
}

/**
 * 마크다운에 frontmatter를 주입하거나 교체한다.
 * 기존 frontmatter가 있으면 병합 (기존 값 우선).
 */
export function inject(markdown: string, newFm: Frontmatter): string {
  const { frontmatter: existing, body } = parse(markdown);

  // 기존 값 우선 병합 (봇은 빈 필드만 채움)
  const merged: Frontmatter = { ...newFm };
  for (const [key, value] of Object.entries(existing)) {
    if (value !== undefined && value !== null) {
      merged[key] = value;
    }
  }

  return stringify(merged) + "\n" + body;
}

/**
 * 오늘 날짜를 YYYY-MM-DD로 반환한다.
 */
export function today(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * 기본 frontmatter를 생성한다.
 */
export function createDefault(overrides: Partial<Frontmatter> = {}): Frontmatter {
  return {
    para: "resource",
    tags: [],
    created: today(),
    status: "active",
    summary: "",
    source: "import",
    ...overrides,
  };
}
