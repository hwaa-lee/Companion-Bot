/**
 * Session management for background commands
 * OpenClaw 스타일: 기본적으로 모든 명령 허용
 */

import { spawn, ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import { promisify } from "util";
import { exec } from "child_process";
import {
  SESSION_MAX_OUTPUT_LINES,
  SESSION_CLEANUP_INTERVAL_MS,
  SESSION_TTL_MS,
} from "../utils/constants.js";
import * as path from "path";

const execAsync = promisify(exec);

// 홈 디렉토리
const home = process.env.HOME || "";

// ============== 세션 관리 ==============
export interface ProcessSession {
  id: string;
  pid: number;
  command: string;
  cwd: string;
  startTime: Date;
  endTime?: Date;
  exitCode?: number | null;
  outputBuffer: string[];
  process: ChildProcess;
  status: "running" | "completed" | "killed" | "error";
}

// 메모리에 세션 저장
const sessions = new Map<string, ProcessSession>();

// 완료된 세션 자동 정리 함수
function cleanupStaleSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.status !== "running" && session.endTime) {
      const age = now - session.endTime.getTime();
      if (age > SESSION_TTL_MS) {
        sessions.delete(id);
      }
    }
  }
}

// 주기적 세션 정리 시작
setInterval(cleanupStaleSessions, SESSION_CLEANUP_INTERVAL_MS);

function appendOutput(session: ProcessSession, data: string) {
  const lines = data.split("\n");
  session.outputBuffer.push(...lines);
  if (session.outputBuffer.length > SESSION_MAX_OUTPUT_LINES) {
    session.outputBuffer = session.outputBuffer.slice(-SESSION_MAX_OUTPUT_LINES);
  }
}

// 환경 변수 (민감한 정보 제외)
function getExecEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  
  // 민감한 환경변수 제거
  const sensitiveKeys = [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    "BRAVE_API_KEY",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REFRESH_TOKEN",
  ];
  
  for (const key of sensitiveKeys) {
    delete env[key];
  }
  
  return env;
}

// run_command 실행 - OpenClaw 스타일 (제한 없음)
export async function executeRunCommand(input: Record<string, unknown>): Promise<string> {
  const command = input.command as string;
  const cwd = (input.cwd as string) || home;
  const background = (input.background as boolean) || false;
  const timeout = ((input.timeout as number) || 30) * 1000;

  // cwd 존재 확인
  const resolvedCwd = path.resolve(cwd);
  
  const execEnv = getExecEnv();

  // Background 실행
  if (background) {
    const sessionId = randomUUID().slice(0, 8);
    
    const child = spawn("sh", ["-c", command], {
      cwd: resolvedCwd,
      env: execEnv,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const session: ProcessSession = {
      id: sessionId,
      pid: child.pid!,
      command,
      cwd: resolvedCwd,
      startTime: new Date(),
      outputBuffer: [],
      process: child,
      status: "running",
    };

    child.stdout?.on("data", (data: Buffer) => {
      appendOutput(session, data.toString());
    });
    child.stderr?.on("data", (data: Buffer) => {
      appendOutput(session, `[stderr] ${data.toString()}`);
    });

    child.on("close", (code) => {
      session.endTime = new Date();
      session.exitCode = code;
      session.status = code === 0 ? "completed" : "error";
    });

    child.on("error", (err) => {
      session.status = "error";
      appendOutput(session, `[error] ${err.message}`);
    });

    child.unref();
    sessions.set(sessionId, session);

    return `백그라운드 세션 시작됨
Session ID: ${sessionId}
PID: ${child.pid}
Command: ${command}
CWD: ${resolvedCwd}

manage_session으로 세션 관리 가능 (list/log/kill)`;
  }

  // Foreground 실행
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: resolvedCwd,
      timeout,
      env: execEnv,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return stdout || stderr || "명령 실행 완료 (출력 없음)";
  } catch (error: unknown) {
    if (error && typeof error === "object" && "stdout" in error) {
      // 명령이 실패해도 출력이 있으면 보여줌
      const e = error as { stdout?: string; stderr?: string; message?: string };
      const output = (e.stdout || "") + (e.stderr || "");
      if (output) {
        return `[exit code != 0]\n${output}`;
      }
    }
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// list_sessions 실행
export function executeListSessions(input: Record<string, unknown>): string {
  const statusFilter = (input.status as string) || "all";
  
  const sessionList: string[] = [];
  
  for (const [id, session] of sessions) {
    if (statusFilter !== "all") {
      if (statusFilter === "running" && session.status !== "running") continue;
      if (statusFilter === "completed" && session.status === "running") continue;
    }

    const runtime = session.endTime 
      ? `${Math.round((session.endTime.getTime() - session.startTime.getTime()) / 1000)}s`
      : `${Math.round((Date.now() - session.startTime.getTime()) / 1000)}s (실행 중)`;

    const status = session.status === "running" 
      ? "🟢 실행 중" 
      : session.status === "completed" 
        ? "✅ 완료" 
        : session.status === "killed"
          ? "🔴 종료됨"
          : "❌ 에러";

    sessionList.push(`[${id}] ${status}
  Command: ${session.command}
  PID: ${session.pid}
  Runtime: ${runtime}
  Exit code: ${session.exitCode ?? "N/A"}`);
  }

  if (sessionList.length === 0) {
    return `세션 없음${statusFilter !== "all" ? ` (필터: "${statusFilter}")` : ""}`;
  }

  return `세션 목록 (${sessionList.length}개):\n\n${sessionList.join("\n\n")}`;
}

// get_session_log 실행
export function executeGetSessionLog(input: Record<string, unknown>): string {
  const sessionId = input.session_id as string;
  const tail = (input.tail as number) || 50;

  const session = sessions.get(sessionId);
  if (!session) {
    return `Error: 세션 "${sessionId}"을 찾을 수 없어. list_sessions로 확인해봐.`;
  }

  const lines = session.outputBuffer.slice(-tail);
  
  if (lines.length === 0) {
    return `세션 ${sessionId} 출력 없음
상태: ${session.status}
명령어: ${session.command}`;
  }

  const header = `세션: ${sessionId} (${session.status})
명령어: ${session.command}
마지막 ${lines.length}줄:
${"─".repeat(40)}`;

  return `${header}\n${lines.join("\n")}`;
}

// kill_session 실행
export function executeKillSession(input: Record<string, unknown>): string {
  const sessionId = input.session_id as string;
  const signal = (input.signal as NodeJS.Signals) || "SIGTERM";

  const session = sessions.get(sessionId);
  if (!session) {
    return `Error: 세션 "${sessionId}"을 찾을 수 없어.`;
  }

  if (session.status !== "running") {
    return `세션 ${sessionId}은 이미 실행 중이 아니야 (상태: ${session.status})`;
  }

  try {
    process.kill(-session.pid, signal);
    session.status = "killed";
    session.endTime = new Date();
    return `세션 ${sessionId} (PID ${session.pid}) ${signal}로 종료됨`;
  } catch (error) {
    try {
      session.process.kill(signal);
      session.status = "killed";
      session.endTime = new Date();
      return `세션 ${sessionId} ${signal}로 종료됨`;
    } catch (e) {
      return `Error: 세션 종료 실패 - ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
