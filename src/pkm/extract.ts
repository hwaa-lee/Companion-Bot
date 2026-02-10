/**
 * 바이너리 파일 텍스트 추출 모듈
 *
 * AI-PKM의 extract_binary.py를 TypeScript로 포팅.
 * PDF/PPTX/XLSX에서 텍스트와 메타데이터를 추출한다.
 *
 * OOXML(PPTX/XLSX)은 실제로 ZIP 파일이므로 Node.js 내장 모듈만으로 추출 가능.
 * PDF는 텍스트 스트림 파싱으로 기본 추출, 정밀 추출은 외부 라이브러리 필요.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { createReadStream } from "fs";
import { Readable } from "stream";

const MAX_TEXT_LENGTH = 5000;

// ============================================
// 타입 정의
// ============================================

export interface ExtractResult {
  success: boolean;
  file: { name: string; format: string; size_kb: number } | null;
  metadata: Record<string, unknown>;
  text: string | null;
  error: string | null;
}

// ============================================
// 메인 함수
// ============================================

/**
 * 파일에서 텍스트와 메타데이터를 추출한다.
 */
export async function extract(filePath: string): Promise<ExtractResult> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return errorResult(path.basename(filePath), "파일이 아닙니다");
    }

    const fileInfo = {
      name: path.basename(filePath),
      format: path.extname(filePath).slice(1).toLowerCase(),
      size_kb: Math.round(stat.size / 1024 * 10) / 10,
    };

    const ext = path.extname(filePath).toLowerCase();
    let metadata: Record<string, unknown> = {};
    let text: string | null = null;

    if (ext === ".pdf") {
      ({ metadata, text } = await extractPdf(filePath));
    } else if (ext === ".pptx") {
      ({ metadata, text } = await extractPptx(filePath));
    } else if (ext === ".xlsx") {
      ({ metadata, text } = await extractXlsx(filePath));
    } else if ([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"].includes(ext)) {
      metadata = { type: "image" };
      text = null;
    } else if ([".md", ".txt", ".csv", ".json", ".yaml", ".yml"].includes(ext)) {
      // 텍스트 파일은 직접 읽기
      const content = await fs.readFile(filePath, "utf-8");
      text = content.length > MAX_TEXT_LENGTH
        ? content.slice(0, MAX_TEXT_LENGTH) + "\n... (잘림)"
        : content;
      metadata = { type: "text" };
    }

    if (text && text.length > MAX_TEXT_LENGTH) {
      text = text.slice(0, MAX_TEXT_LENGTH) + "\n... (잘림)";
    }

    return { success: true, file: fileInfo, metadata: cleanDict(metadata), text, error: null };
  } catch (err) {
    return errorResult(path.basename(filePath), `추출 실패: ${err}`);
  }
}

function errorResult(name: string, error: string): ExtractResult {
  return {
    success: false,
    file: { name, format: "", size_kb: 0 },
    metadata: {},
    text: null,
    error,
  };
}

// ============================================
// PDF 추출 (기본 텍스트 스트림 파싱)
// ============================================

async function extractPdf(filePath: string): Promise<{ metadata: Record<string, unknown>; text: string | null }> {
  const buffer = await fs.readFile(filePath);
  const content = buffer.toString("latin1");
  const metadata: Record<string, unknown> = {};

  // 메타데이터 추출
  const fieldPatterns: Record<string, RegExp> = {
    title: /\/Title\s*\(([^)]+)\)/,
    author: /\/Author\s*\(([^)]+)\)/,
    subject: /\/Subject\s*\(([^)]+)\)/,
    creator: /\/Creator\s*\(([^)]+)\)/,
  };

  for (const [field, pattern] of Object.entries(fieldPatterns)) {
    const match = content.match(pattern);
    if (match) {
      metadata[field] = decodePdfString(match[1]);
    }
  }

  // 페이지 수 추정
  const pageMatches = content.match(/\/Type\s*\/Page[^s]/g);
  if (pageMatches) {
    metadata.page_count = pageMatches.length;
  }

  // 텍스트 스트림 추출 시도
  const textChunks: string[] = [];
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;

  while ((match = streamRegex.exec(content)) !== null) {
    const streamContent = match[1];
    // 텍스트 연산자에서 문자열 추출
    const textMatches = streamContent.match(/\(([^)]+)\)\s*Tj/g);
    if (textMatches) {
      for (const tm of textMatches) {
        const textMatch = tm.match(/\(([^)]+)\)/);
        if (textMatch) {
          const decoded = decodePdfString(textMatch[1]);
          if (decoded.trim()) {
            textChunks.push(decoded.trim());
          }
        }
      }
    }

    // TJ 배열 연산자
    const tjMatches = streamContent.match(/\[(.*?)\]\s*TJ/g);
    if (tjMatches) {
      for (const tj of tjMatches) {
        const strings = tj.match(/\(([^)]*)\)/g);
        if (strings) {
          const combined = strings.map(s => decodePdfString(s.slice(1, -1))).join("");
          if (combined.trim()) {
            textChunks.push(combined.trim());
          }
        }
      }
    }
  }

  const text = textChunks.length > 0 ? textChunks.join("\n") : null;
  return { metadata, text };
}

function decodePdfString(s: string): string {
  return s
    .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

// ============================================
// PPTX 추출 (ZIP + XML)
// ============================================

async function extractPptx(filePath: string): Promise<{ metadata: Record<string, unknown>; text: string | null }> {
  const { entries, readEntry } = await openZip(filePath);
  const metadata = await extractOoxmlMetadata(entries, readEntry);

  // 슬라이드 파일 찾기
  const slideFiles = entries
    .filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)?.[1] || "0");
      const numB = parseInt(b.match(/slide(\d+)/)?.[1] || "0");
      return numA - numB;
    });

  metadata.slide_count = slideFiles.length;

  const slidesText: string[] = [];
  const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";

  for (let i = 0; i < slideFiles.length; i++) {
    const content = await readEntry(slideFiles[i]);
    const texts = extractXmlTexts(content, NS_A, "t");

    if (texts.length > 0) {
      slidesText.push(`[슬라이드 ${i + 1}]\n${texts.join("\n")}`);
    }
  }

  const text = slidesText.length > 0 ? slidesText.join("\n\n") : null;
  return { metadata, text };
}

// ============================================
// XLSX 추출 (ZIP + XML)
// ============================================

async function extractXlsx(filePath: string): Promise<{ metadata: Record<string, unknown>; text: string | null }> {
  const { entries, readEntry } = await openZip(filePath);
  const metadata = await extractOoxmlMetadata(entries, readEntry);

  const NS_SHEET = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

  // Shared strings 로드
  const sharedStrings: string[] = [];
  if (entries.includes("xl/sharedStrings.xml")) {
    const content = await readEntry("xl/sharedStrings.xml");
    const siRegex = new RegExp(`<si[^>]*>([\\s\\S]*?)<\\/si>`, "g");
    let siMatch;
    while ((siMatch = siRegex.exec(content)) !== null) {
      const tRegex = /<t[^>]*>([^<]*)<\/t>/g;
      let tMatch;
      const texts: string[] = [];
      while ((tMatch = tRegex.exec(siMatch[1])) !== null) {
        texts.push(tMatch[1]);
      }
      sharedStrings.push(texts.join(""));
    }
  }

  // 시트 이름
  const sheetNames: string[] = [];
  if (entries.includes("xl/workbook.xml")) {
    const content = await readEntry("xl/workbook.xml");
    const sheetRegex = /name="([^"]+)"/g;
    let sm;
    // workbook.xml에서 sheet 태그 내 name 속성
    const sheetsSection = content.match(/<sheets>([\s\S]*?)<\/sheets>/);
    if (sheetsSection) {
      while ((sm = sheetRegex.exec(sheetsSection[1])) !== null) {
        sheetNames.push(sm[1]);
      }
    }
  }

  metadata.sheet_count = sheetNames.length;
  metadata.sheet_names = sheetNames;

  // 시트 파일
  const sheetFiles = entries
    .filter(e => /^xl\/worksheets\/sheet\d+\.xml$/.test(e))
    .sort((a, b) => {
      const numA = parseInt(a.match(/sheet(\d+)/)?.[1] || "0");
      const numB = parseInt(b.match(/sheet(\d+)/)?.[1] || "0");
      return numA - numB;
    });

  const sheetsText: string[] = [];

  for (let idx = 0; idx < sheetFiles.length; idx++) {
    const sheetName = sheetNames[idx] || `Sheet${idx + 1}`;
    const content = await readEntry(sheetFiles[idx]);

    const rowsText: string[] = [];
    const rowRegex = /<row[^>]*>([\s\S]*?)<\/row>/g;
    let rowMatch;
    let rowCount = 0;

    while ((rowMatch = rowRegex.exec(content)) !== null) {
      const cells: string[] = [];
      const cellRegex = /<c[^>]*?(t="([^"]*)")?[^>]*>([\s\S]*?)<\/c>/g;
      let cellMatch;

      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        const cellType = cellMatch[2] || "";
        const vMatch = cellMatch[3].match(/<v>([^<]*)<\/v>/);

        if (vMatch) {
          if (cellType === "s") {
            const idx = parseInt(vMatch[1]);
            cells.push(idx < sharedStrings.length ? sharedStrings[idx] : vMatch[1]);
          } else {
            cells.push(vMatch[1]);
          }
        } else {
          cells.push("");
        }
      }

      if (cells.some(c => c.trim())) {
        rowsText.push(cells.join(" | "));
        rowCount++;
      }

      if (rowCount >= 100) {
        rowsText.push("... (이하 생략)");
        break;
      }
    }

    if (rowsText.length > 0) {
      sheetsText.push(`[시트: ${sheetName}]\n${rowsText.join("\n")}`);
    }
  }

  const text = sheetsText.length > 0 ? sheetsText.join("\n\n") : null;
  return { metadata, text };
}

// ============================================
// OOXML 공통 메타데이터
// ============================================

async function extractOoxmlMetadata(
  entries: string[],
  readEntry: (name: string) => Promise<string>
): Promise<Record<string, unknown>> {
  const metadata: Record<string, unknown> = {};

  if (!entries.includes("docProps/core.xml")) return metadata;

  const content = await readEntry("docProps/core.xml");

  const extract = (tag: string): string | undefined => {
    const match = content.match(new RegExp(`<[^>]*:?${tag}[^>]*>([^<]+)<`));
    return match?.[1]?.trim();
  };

  metadata.title = extract("title");
  metadata.author = extract("creator");
  metadata.subject = extract("subject");
  metadata.description = extract("description");
  metadata.created = extract("created");
  metadata.modified = extract("modified");

  return cleanDict(metadata);
}

// ============================================
// ZIP 유틸리티 (Node.js 내장 zlib 기반)
// ============================================

/**
 * ZIP 파일을 열고 엔트리 목록과 읽기 함수를 반환한다.
 * Node.js 내장 모듈만 사용.
 */
async function openZip(filePath: string): Promise<{
  entries: string[];
  readEntry: (name: string) => Promise<string>;
}> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  // unzip -l 로 엔트리 목록
  const { stdout: listOutput } = await execFileAsync("unzip", ["-l", filePath]);
  const entries = listOutput
    .split("\n")
    .map(line => {
      const match = line.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+)$/);
      return match?.[1]?.trim();
    })
    .filter((e): e is string => !!e && !e.endsWith("/"));

  const readEntry = async (name: string): Promise<string> => {
    const { stdout } = await execFileAsync("unzip", ["-p", filePath, name], {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  };

  return { entries, readEntry };
}

// ============================================
// 유틸리티
// ============================================

function extractXmlTexts(xml: string, namespace: string, tagName: string): string[] {
  const texts: string[] = [];
  // 네임스페이스 있는 태그와 없는 태그 모두 매칭
  const regex = new RegExp(`<(?:[^:]+:)?${tagName}[^>]*>([^<]*)<\\/(?:[^:]+:)?${tagName}>`, "g");
  let match;
  while ((match = regex.exec(xml)) !== null) {
    if (match[1].trim()) {
      texts.push(match[1].trim());
    }
  }
  return texts;
}

function cleanDict(d: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v !== undefined && v !== null && v !== "") {
      result[k] = v;
    }
  }
  return result;
}

/**
 * 바이너리 파일인지 확인한다.
 */
export function isBinaryFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return [".pdf", ".pptx", ".xlsx", ".docx", ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".heic", ".zip"].includes(ext);
}

/**
 * 동반 마크다운 파일 경로를 반환한다.
 * 예: report.pdf → report.pdf.md
 */
export function companionMdPath(filePath: string): string {
  return filePath + ".md";
}
