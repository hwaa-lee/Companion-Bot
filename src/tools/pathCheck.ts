/**
 * Path validation utilities for security
 * OpenClaw 스타일: 기본적으로 홈 디렉토리 전체 접근 허용
 * 
 * 민감한 파일만 보호 (API 키, 인증 정보 등)
 */

import * as fs from "fs";
import * as path from "path";

// 홈 디렉토리
const home = process.env.HOME || "";

// 민감한 파일 패턴 (이것만 차단)
export const SENSITIVE_PATTERNS = [
  /\.env$/,           // 환경변수 파일
  /\.env\..+$/,       // .env.local, .env.production 등
  /\.npmrc$/,         // npm 인증
  /\.pypirc$/,        // PyPI 인증
  /\.netrc$/,         // 네트워크 인증
  /\.git-credentials$/,
  /credentials\.json$/,
  /token\.json$/,
  /\.companionbot\/config\.json$/,  // 봇 설정 (API 키 포함)
];

/**
 * 허용된 디렉토리 목록 반환
 * OpenClaw 스타일: 홈 디렉토리 전체 + /tmp
 */
export function getAllowedPaths(): string[] {
  return [
    home,    // 홈 디렉토리 전체
    "/tmp",  // 임시 디렉토리
  ];
}

/**
 * 주어진 경로가 허용된 디렉토리 내에 있는지 검증
 */
export function isPathAllowed(
  targetPath: string,
  allowedPaths?: string[]
): boolean {
  try {
    const resolved = path.resolve(targetPath);

    // 민감한 파일 패턴 차단
    if (SENSITIVE_PATTERNS.some((p) => p.test(resolved))) {
      return false;
    }

    const allowed = allowedPaths ?? getAllowedPaths();

    // 심볼릭 링크 해제하여 실제 경로 확인
    let realPath: string;
    try {
      realPath = fs.realpathSync(resolved);
    } catch {
      // 파일이 없으면 부모 디렉토리 확인
      const parentDir = path.dirname(resolved);
      try {
        realPath = path.join(
          fs.realpathSync(parentDir),
          path.basename(resolved)
        );
      } catch {
        return false;
      }
    }

    // 경로 비교
    return allowed.some((allowedPath) => {
      const normalizedAllowed = path.resolve(allowedPath);
      return (
        realPath === normalizedAllowed ||
        realPath.startsWith(normalizedAllowed + path.sep)
      );
    });
  } catch {
    return false;
  }
}
