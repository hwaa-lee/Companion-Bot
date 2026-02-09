/**
 * Path validation utilities for security
 * 보안 크리티컬 - 허용된 경로만 접근 가능하도록 검증
 */

import * as fsSync from "fs";
import * as path from "path";
import { getWorkspacePath } from "../workspace/index.js";

// 홈 디렉토리
const home = process.env.HOME || "";

// 위험한 파일 패턴
export const DANGEROUS_PATTERNS = [
  /\.bashrc$/,
  /\.zshrc$/,
  /\.bash_profile$/,
  /\.profile$/,
  /\.ssh\//,
  /\.git\/hooks\//,
  /\.git\/config$/,
  /\.env$/,
  /\.npmrc$/,
];

/**
 * 허용된 디렉토리 목록 반환
 * OpenClaw 스타일: 홈 디렉토리 전체 접근 가능
 */
export function getAllowedPaths(): string[] {
  return [
    home,  // 홈 디렉토리 전체
    "/tmp",  // 임시 디렉토리
  ];
}

/**
 * 주어진 경로가 허용된 디렉토리 내에 있는지 검증
 * 
 * 보안 고려사항:
 * - 심볼릭 링크를 해석하여 실제 경로 확인
 * - 위험한 파일 패턴 차단
 * - 허용된 디렉토리 외부 접근 차단
 * 
 * ⚠️ TOCTOU (Time-of-check to time-of-use) 주의:
 * realpathSync() 호출과 실제 파일 작업 사이에 심볼릭 링크가 변경될 수 있음.
 * 완전한 방지를 위해서는 chroot/namespace 격리를 권장.
 */
export function isPathAllowed(
  targetPath: string,
  allowedPaths?: string[]
): boolean {
  try {
    const resolved = path.resolve(targetPath);

    // 위험한 파일 패턴 차단
    if (DANGEROUS_PATTERNS.some((p) => p.test(resolved))) {
      return false;
    }

    // 심볼릭 링크 해제하여 실제 경로 확인
    let realPath: string;
    try {
      realPath = fsSync.realpathSync(resolved);
    } catch {
      // 파일이 아직 없으면 (write_file) 부모 디렉토리 확인
      const parentDir = path.dirname(resolved);
      try {
        realPath = path.join(
          fsSync.realpathSync(parentDir),
          path.basename(resolved)
        );
      } catch {
        // 부모 디렉토리도 resolve 실패 시 거부
        return false;
      }
    }

    const allowed = allowedPaths ?? getAllowedPaths();

    // 정확한 경로 구분자로 비교 (startsWith만으로는 ~/DocumentsEvil 같은 경로 통과)
    return allowed.some((allowedPath) => {
      const normalizedAllowed = path.resolve(allowedPath);
      return (
        realPath === normalizedAllowed ||
        realPath.startsWith(normalizedAllowed + path.sep)
      );
    });
  } catch {
    // 어떤 예외든 검증 실패로 처리 (fail-safe)
    return false;
  }
}
