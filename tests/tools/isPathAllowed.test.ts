/**
 * isPathAllowed 보안 테스트
 * 이 함수는 보안 크리티컬 - 모든 파일 접근이 여기를 통과함
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { isPathAllowed, SENSITIVE_PATTERNS } from "../../src/tools/pathCheck.js";

describe("isPathAllowed", () => {
  // 테스트용 임시 디렉토리
  let tempDir: string;
  let allowedDir: string;
  let outsideDir: string;

  beforeAll(() => {
    // macOS에서 /tmp는 /private/tmp의 심볼릭 링크이므로 realpath로 실제 경로 사용
    const tmpBase = fs.realpathSync(os.tmpdir());
    tempDir = fs.mkdtempSync(path.join(tmpBase, "path-test-"));
    allowedDir = path.join(tempDir, "allowed");
    outsideDir = path.join(tempDir, "outside");
    
    fs.mkdirSync(allowedDir, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    
    // 테스트 파일 생성
    fs.writeFileSync(path.join(allowedDir, "test.txt"), "allowed");
    fs.writeFileSync(path.join(outsideDir, "secret.txt"), "secret");
  });

  afterAll(() => {
    // 정리
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("기본 접근 검증", () => {
    it("허용된 디렉토리 내 파일 접근 허용", () => {
      const filePath = path.join(allowedDir, "test.txt");
      expect(isPathAllowed(filePath, [allowedDir])).toBe(true);
    });

    it("허용된 디렉토리 자체 접근 허용", () => {
      expect(isPathAllowed(allowedDir, [allowedDir])).toBe(true);
    });

    it("허용된 디렉토리 외부 접근 차단", () => {
      const filePath = path.join(outsideDir, "secret.txt");
      expect(isPathAllowed(filePath, [allowedDir])).toBe(false);
    });

    it("존재하지 않는 파일도 부모 디렉토리가 허용되면 허용", () => {
      const newFile = path.join(allowedDir, "new-file.txt");
      expect(isPathAllowed(newFile, [allowedDir])).toBe(true);
    });

    it("부모 디렉토리도 존재하지 않으면 차단", () => {
      const badPath = "/nonexistent/directory/file.txt";
      expect(isPathAllowed(badPath, [allowedDir])).toBe(false);
    });
  });

  describe("경로 조작 공격 방어", () => {
    it(".. 를 사용한 디렉토리 탈출 차단", () => {
      const escapePath = path.join(allowedDir, "..", "outside", "secret.txt");
      expect(isPathAllowed(escapePath, [allowedDir])).toBe(false);
    });

    it("다중 .. 로 루트 접근 시도 차단", () => {
      const rootEscape = path.join(allowedDir, "..", "..", "..", "..", "etc", "passwd");
      expect(isPathAllowed(rootEscape, [allowedDir])).toBe(false);
    });

    it("비슷한 이름의 디렉토리 (allowedEvil) 차단", () => {
      // allowedDir이 /tmp/.../allowed 일 때
      // /tmp/.../allowedEvil 은 허용되면 안 됨
      const evilDir = allowedDir + "Evil";
      fs.mkdirSync(evilDir, { recursive: true });
      fs.writeFileSync(path.join(evilDir, "evil.txt"), "evil");
      
      expect(isPathAllowed(path.join(evilDir, "evil.txt"), [allowedDir])).toBe(false);
      
      fs.rmSync(evilDir, { recursive: true });
    });
  });

  describe("위험한 파일 패턴 차단", () => {
    it(".bashrc 접근 차단", () => {
      expect(isPathAllowed("/home/user/.bashrc", ["/home/user"])).toBe(false);
    });

    it(".ssh/ 디렉토리 접근 차단", () => {
      expect(isPathAllowed("/home/user/.ssh/id_rsa", ["/home/user"])).toBe(false);
    });

    it(".env 파일 접근 차단", () => {
      expect(isPathAllowed("/project/.env", ["/project"])).toBe(false);
    });

    it(".git/hooks/ 접근 차단", () => {
      expect(isPathAllowed("/project/.git/hooks/pre-commit", ["/project"])).toBe(false);
    });

    it(".git/config 접근 차단", () => {
      expect(isPathAllowed("/project/.git/config", ["/project"])).toBe(false);
    });

    it(".npmrc 접근 차단", () => {
      expect(isPathAllowed("/home/user/.npmrc", ["/home/user"])).toBe(false);
    });
  });

  describe("심볼릭 링크 처리", () => {
    let symlinkPath: string;

    beforeAll(() => {
      // 허용된 디렉토리에서 외부를 가리키는 심볼릭 링크 생성
      symlinkPath = path.join(allowedDir, "escape-link");
      try {
        fs.symlinkSync(outsideDir, symlinkPath);
      } catch {
        // 권한이 없으면 스킵
      }
    });

    afterAll(() => {
      try {
        fs.unlinkSync(symlinkPath);
      } catch {
        // 무시
      }
    });

    it("외부를 가리키는 심볼릭 링크 차단", () => {
      if (!fs.existsSync(symlinkPath)) {
        return; // symlink 생성 실패시 스킵
      }
      
      const throughSymlink = path.join(symlinkPath, "secret.txt");
      expect(isPathAllowed(throughSymlink, [allowedDir])).toBe(false);
    });
  });

  describe("SENSITIVE_PATTERNS 검증", () => {
    it("모든 위험 패턴이 정의되어 있음", () => {
      expect(SENSITIVE_PATTERNS.length).toBeGreaterThan(0);
    });

    it(".env 패턴 매칭", () => {
      expect(SENSITIVE_PATTERNS.some(p => p.test("/home/user/.env"))).toBe(true);
    });

    it(".npmrc 패턴 매칭", () => {
      expect(SENSITIVE_PATTERNS.some(p => p.test("/home/user/.npmrc"))).toBe(true);
    });

    it("일반 파일은 패턴 매칭 안 됨", () => {
      expect(SENSITIVE_PATTERNS.some(p => p.test("/home/user/document.txt"))).toBe(false);
    });
  });

  describe("엣지 케이스", () => {
    it("빈 문자열 경로 차단", () => {
      expect(isPathAllowed("", [allowedDir])).toBe(false);
    });

    it("빈 허용 목록시 모든 접근 차단", () => {
      expect(isPathAllowed(path.join(allowedDir, "test.txt"), [])).toBe(false);
    });

    it("상대 경로도 올바르게 처리", () => {
      const cwd = process.cwd();
      process.chdir(allowedDir);
      
      expect(isPathAllowed("./test.txt", [allowedDir])).toBe(true);
      expect(isPathAllowed("../outside/secret.txt", [allowedDir])).toBe(false);
      
      process.chdir(cwd);
    });
  });
});
