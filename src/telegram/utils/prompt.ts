import { MODELS, type ModelId, type Message } from "../../ai/claude.js";
import { getWorkspacePath } from "../../workspace/index.js";
import { getToolsDescription } from "../../tools/index.js";
import { getWorkspace } from "./cache.js";
import { embed } from "../../memory/embeddings.js";
import { search } from "../../memory/vectorStore.js";

/**
 * identity.md에서 이름을 추출합니다.
 */
export function extractName(identityContent: string | null): string | null {
  if (!identityContent) return null;

  const match = identityContent.match(/##\s*이름\s*\n+([^\n(]+)/);
  if (match && match[1]) {
    const name = match[1].trim();
    if (name && !name.includes("정해지지") && !name.includes("아직")) {
      return name;
    }
  }
  return null;
}

/**
 * 최근 대화에서 검색 쿼리 컨텍스트를 추출합니다.
 */
function extractSearchContext(history: Message[]): string {
  const recent = history.slice(-3);
  return recent
    .filter((m) => m.role === "user")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join(" ")
    .slice(0, 500);
}

/**
 * 대화 컨텍스트와 관련된 메모리를 검색합니다.
 */
async function getRelevantMemories(history: Message[]): Promise<string> {
  try {
    const context = extractSearchContext(history);
    if (!context.trim()) return "";

    const queryEmbedding = await embed(context);
    const results = await search(queryEmbedding, 3, 0.4); // 상위 3개, 유사도 0.4 이상

    if (results.length === 0) return "";

    return (
      "\n\n## 관련 기억\n" +
      results
        .map((r) => `- (${r.source}): ${r.text.slice(0, 200)}${r.text.length > 200 ? "..." : ""}`)
        .join("\n")
    );
  } catch {
    return "";
  }
}

/**
 * 현재 날짜/시간을 한국어 포맷으로 반환합니다.
 */
function getKoreanDateTime(): { formatted: string; timezone: string } {
  const now = new Date();
  const timezone = "Asia/Seoul";

  const formatter = new Intl.DateTimeFormat("ko-KR", {
    timeZone: timezone,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const formatted = formatter.format(now);

  return {
    formatted,
    timezone: `${timezone} (GMT+9)`,
  };
}

/**
 * 시스템 프롬프트를 동적으로 생성합니다.
 * @param modelId 사용할 모델 ID
 * @param history 대화 히스토리 (관련 메모리 검색에 사용)
 */
export async function buildSystemPrompt(modelId: ModelId, history?: Message[]): Promise<string> {
  const model = MODELS[modelId];
  const workspace = await getWorkspace();
  const parts: string[] = [];

  // 기본 정보
  parts.push(`You are a personal AI companion running on ${model.name}.`);
  parts.push(`Workspace: ${getWorkspacePath()}`);

  // 런타임 정보 (날짜/시간)
  const dateTime = getKoreanDateTime();
  parts.push(`Current time: ${dateTime.formatted}`);
  parts.push(`Timezone: ${dateTime.timezone}`);

  // 채널/플랫폼 정보
  parts.push(`Runtime: channel=telegram | capabilities=markdown,inline_keyboard,reactions | version=0.4.x`);

  // BOOTSTRAP 모드인 경우
  if (workspace.bootstrap) {
    parts.push("---");
    parts.push("# 온보딩 모드 활성화");
    parts.push(workspace.bootstrap);
    parts.push("---");
    parts.push(`온보딩 완료 후 save_persona 도구를 사용하여 설정을 저장하세요.`);
  } else {
    // 일반 모드: 워크스페이스 파일들 로드
    if (workspace.identity) {
      parts.push("---");
      parts.push(workspace.identity);
    }

    if (workspace.soul) {
      parts.push("---");
      parts.push(workspace.soul);
    }

    if (workspace.user) {
      parts.push("---");
      parts.push(workspace.user);
    }

    if (workspace.agents) {
      parts.push("---");
      parts.push(workspace.agents);
    }

    // 관련 기억 로드 (대화 컨텍스트 기반)
    if (history && history.length > 0) {
      const relevantMemories = await getRelevantMemories(history);
      if (relevantMemories) {
        parts.push("---");
        parts.push("# 관련 기억");
        parts.push(relevantMemories);
      }
    }

    if (workspace.memory) {
      parts.push("---");
      parts.push("# 장기 기억");
      parts.push(workspace.memory);
    }
  }

  // 도구 설명
  parts.push("---");
  parts.push(getToolsDescription(modelId));

  return parts.join("\n\n");
}
