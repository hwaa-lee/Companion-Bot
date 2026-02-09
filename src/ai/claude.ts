import Anthropic from "@anthropic-ai/sdk";
import { tools, executeTool } from "../tools/index.js";

let anthropic: Anthropic | null = null;

function getClient(): Anthropic {
  if (!anthropic) {
    anthropic = new Anthropic();
  }
  return anthropic;
}

export type Message = {
  role: "user" | "assistant";
  content: string | Anthropic.ContentBlock[] | Anthropic.ContentBlockParam[];
};

export type ImageData = {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
};

export type ModelId = "sonnet" | "opus" | "haiku";

export type ModelConfig = {
  id: string;
  name: string;
  maxTokens: number;
  thinkingBudget: number; // 0 = thinking 비활성화
};

// 모델별 max_tokens 및 thinking budget 설정
// 참고: Claude API에서 thinking + output이 모델 한도 초과하면 안 됨
export const MODELS: Record<ModelId, ModelConfig> = {
  haiku: {
    id: "claude-haiku-3-5-20241022",
    name: "Claude Haiku 3.5",
    maxTokens: 4096,        // 빠른 응답
    thinkingBudget: 0,      // Haiku는 thinking 미지원
  },
  sonnet: {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    maxTokens: 8192,        // 일반 작업
    thinkingBudget: 10000,  // 적당한 thinking
  },
  opus: {
    id: "claude-opus-4-20250514",
    name: "Claude Opus 4",
    maxTokens: 16384,       // 복잡한 작업
    thinkingBudget: 32000,  // 깊은 thinking
  },
};

export async function chat(
  messages: Message[],
  systemPrompt?: string,
  modelId: ModelId = "sonnet"
): Promise<string> {
  const client = getClient();
  const modelConfig = MODELS[modelId];

  // 메시지를 API 형식으로 변환
  const apiMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // API 요청 파라미터 빌드 (도구 루프에서도 동일하게 사용)
  const buildRequestParams = (): Anthropic.MessageCreateParamsNonStreaming => {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: modelConfig.id,
      max_tokens: modelConfig.maxTokens,
      messages: apiMessages,
      tools: tools,
    };

    if (systemPrompt) {
      params.system = systemPrompt;
    }

    // thinking 활성화 (budget > 0인 경우)
    if (modelConfig.thinkingBudget > 0) {
      params.thinking = {
        type: "enabled",
        budget_tokens: modelConfig.thinkingBudget,
      };
    }

    return params;
  };

  let response: Anthropic.Message;
  try {
    response = await client.messages.create(buildRequestParams());
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      if (error.status === 429) {
        throw new Error("API 요청이 너무 많아. 잠시 후 다시 시도해줘.");
      }
      if (error.status >= 500) {
        throw new Error("AI 서버에 문제가 생겼어. 잠시 후 다시 시도해줘.");
      }
    }
    throw error;
  }

  // Tool use 루프 - Claude가 도구 사용을 멈출 때까지 반복 (최대 10회)
  const MAX_TOOL_ITERATIONS = 10;
  let iterations = 0;

  while (response.stop_reason === "tool_use" && iterations < MAX_TOOL_ITERATIONS) {
    iterations++;
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    // 도구 실행 결과 수집
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      console.log(`[Tool] ${toolUse.name}:`, JSON.stringify(toolUse.input));

      const result = await executeTool(
        toolUse.name,
        toolUse.input as Record<string, unknown>
      );

      // 결과가 너무 길면 자르기
      const truncatedResult =
        result.length > 10000
          ? result.slice(0, 10000) + "\n... (truncated)"
          : result;

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: truncatedResult,
      });
    }

    // 어시스턴트 메시지와 도구 결과 추가
    apiMessages.push({
      role: "assistant",
      content: response.content,
    });

    apiMessages.push({
      role: "user",
      content: toolResults,
    });

    // 다음 응답 요청 (도구 루프에서도 thinking 유지)
    try {
      response = await client.messages.create(buildRequestParams());
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        if (error.status === 429) {
          throw new Error("API 요청이 너무 많아. 잠시 후 다시 시도해줘.");
        }
        if (error.status >= 500) {
          throw new Error("AI 서버에 문제가 생겼어. 잠시 후 다시 시도해줘.");
        }
      }
      throw error;
    }
  }

  // 반복 횟수 초과 시 경고
  if (iterations >= MAX_TOOL_ITERATIONS) {
    console.warn(`[Warning] Tool use loop reached max iterations (${MAX_TOOL_ITERATIONS})`);
    return "도구 실행이 너무 많이 반복됐어. 다시 시도해줄래?";
  }

  // 최종 텍스트 응답 추출
  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );

  return textBlock?.text ?? "응답을 생성하지 못했어. 다시 시도해줄래?";
}

/**
 * 스마트 채팅 - 가능하면 스트리밍, 도구 필요하면 일반 호출
 * 
 * 전략:
 * - 먼저 스트리밍으로 시도
 * - 도구 호출이 감지되면 (stop_reason === "tool_use") 기존 chat()으로 폴백
 * - 스트리밍은 최종 텍스트 응답에만 사용
 */
export async function chatSmart(
  messages: Message[],
  systemPrompt: string,
  modelId: ModelId,
  onChunk?: (text: string, accumulated: string) => void | Promise<void>
): Promise<{ text: string; usedTools: boolean }> {
  // 스트리밍 콜백이 없으면 그냥 일반 chat 사용
  if (!onChunk) {
    const text = await chat(messages, systemPrompt, modelId);
    return { text, usedTools: false };
  }

  const client = getClient();
  const modelConfig = MODELS[modelId];

  // 메시지를 API 형식으로 변환
  const apiMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // 스트리밍 요청 파라미터
  const params: Anthropic.MessageCreateParamsStreaming = {
    model: modelConfig.id,
    max_tokens: modelConfig.maxTokens,
    messages: apiMessages,
    tools: tools,
    stream: true,
  };

  if (systemPrompt) {
    params.system = systemPrompt;
  }

  // Thinking은 스트리밍에서 복잡해지므로 일단 비활성화
  // (도구 호출 폴백 시 chat()에서 thinking 사용됨)

  let accumulated = "";
  let stopReason: string | null = null;

  try {
    const stream = client.messages.stream(params);

    // 스트리밍 이벤트 처리
    stream.on("text", async (text) => {
      accumulated += text;
      try {
        await onChunk(text, accumulated);
      } catch (err) {
        // editMessageText 실패 등은 무시하고 계속
        console.warn("[Stream] Chunk callback error (ignored):", err);
      }
    });

    // 스트림 완료 대기
    const finalMessage = await stream.finalMessage();
    stopReason = finalMessage.stop_reason;

    // 도구 호출이 필요한 경우 - 일반 chat으로 폴백
    if (stopReason === "tool_use") {
      console.log("[Stream] Tool use detected, falling back to chat()");
      const text = await chat(messages, systemPrompt, modelId);
      return { text, usedTools: true };
    }

    // 성공적으로 스트리밍 완료
    return { text: accumulated, usedTools: false };

  } catch (error) {
    // 스트리밍 에러 핸들링
    if (error instanceof Anthropic.APIError) {
      if (error.status === 429) {
        throw new Error("API 요청이 너무 많아. 잠시 후 다시 시도해줘.");
      }
      if (error.status >= 500) {
        throw new Error("AI 서버에 문제가 생겼어. 잠시 후 다시 시도해줘.");
      }
    }

    // 연결 끊김 등 스트리밍 에러 - 이미 받은 내용이 있으면 반환 시도
    if (accumulated.length > 50) {
      console.warn("[Stream] Connection error, returning partial response");
      return { text: accumulated + "\n\n(연결이 끊겨서 응답이 잘렸을 수 있어)", usedTools: false };
    }

    // 응답이 거의 없으면 일반 chat으로 재시도
    console.warn("[Stream] Connection error, retrying with chat()");
    try {
      const text = await chat(messages, systemPrompt, modelId);
      return { text, usedTools: false };
    } catch (retryError) {
      throw retryError;
    }
  }
}
