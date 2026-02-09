import type { Bot, Context } from "grammy";
import { chat, chatSmart, type Message, type ModelId } from "../../ai/claude.js";
import {
  getHistory,
  getModel,
  runWithChatId,
  trimHistoryByTokens,
} from "../../session/state.js";
import { updateLastMessageTime } from "../../heartbeat/index.js";
import {
  extractUrls,
  fetchWebContent,
  buildSystemPrompt,
} from "../utils/index.js";

/**
 * 스트리밍 응답 전송 (Telegram 메시지 실시간 업데이트)
 */
async function sendStreamingResponse(
  ctx: Context,
  messages: Message[],
  systemPrompt: string,
  modelId: ModelId
): Promise<string> {
  // 1. 먼저 "..." 플레이스홀더 메시지 전송
  const placeholder = await ctx.reply("...");
  const chatId = ctx.chat!.id;
  const messageId = placeholder.message_id;

  let lastUpdate = Date.now();
  const UPDATE_INTERVAL = 500; // 0.5초마다 업데이트 (Telegram rate limit 고려)
  let lastText = "";

  const result = await chatSmart(
    messages,
    systemPrompt,
    modelId,
    async (_chunk: string, accumulated: string) => {
      const now = Date.now();
      // 0.5초마다 또는 충분히 변경되었을 때 업데이트
      if (now - lastUpdate > UPDATE_INTERVAL && accumulated !== lastText) {
        try {
          await ctx.api.editMessageText(chatId, messageId, accumulated + " ▌");
          lastUpdate = now;
          lastText = accumulated;
        } catch {
          // rate limit 등 무시
        }
      }
    }
  );

  // 도구를 사용한 경우 스트리밍이 안됐으므로 새 응답 전송
  if (result.usedTools) {
    // placeholder 메시지를 최종 결과로 교체
    try {
      await ctx.api.editMessageText(chatId, messageId, result.text);
    } catch {
      // 실패시 새 메시지로 전송
      await ctx.api.deleteMessage(chatId, messageId);
      await ctx.reply(result.text);
    }
    return result.text;
  }

  // 최종 메시지 업데이트 (커서 제거)
  try {
    await ctx.api.editMessageText(chatId, messageId, result.text);
  } catch {
    // 이미 동일 텍스트면 에러 발생 가능 - 무시
  }

  return result.text;
}

/**
 * 메시지 핸들러들을 봇에 등록합니다.
 */
export function registerMessageHandlers(bot: Bot): void {
  // 사진 메시지 처리
  bot.on("message:photo", async (ctx) => {
    const chatId = ctx.chat.id;
    
    await runWithChatId(chatId, async () => {
      const history = getHistory(chatId);
      const modelId = getModel(chatId);

      await ctx.replyWithChatAction("typing");

      try {
        // 가장 큰 사진 선택 (마지막이 가장 큼)
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const file = await ctx.api.getFile(photo.file_id);

        if (!file.file_path) {
          await ctx.reply("사진을 가져올 수 없어.");
          return;
        }

        // 파일 크기 제한 (10MB)
        const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
        if (file.file_size && file.file_size > MAX_IMAGE_SIZE) {
          await ctx.reply("사진이 너무 커. 10MB 이하로 보내줄래?");
          return;
        }

        // 파일 다운로드
        const fileUrl = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
        const response = await fetch(fileUrl);
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");

        // 캡션이 있으면 사용, 없으면 기본 질문
        const caption = ctx.message.caption || "이 사진에 뭐가 있어?";

        // 이미지와 텍스트를 함께 전송
        const imageContent = [
          {
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: "image/jpeg" as const,
              data: base64,
            },
          },
          {
            type: "text" as const,
            text: caption,
          },
        ];

        history.push({ role: "user", content: imageContent });

        try {
          const systemPrompt = await buildSystemPrompt(modelId, history);
          const result = await chat(history, systemPrompt, modelId);

          history.push({ role: "assistant", content: result });

          // 토큰 기반 히스토리 트리밍
          trimHistoryByTokens(history);

          await ctx.reply(result);
        } catch (innerError) {
          // 에러 시 방금 추가한 사용자 메시지 롤백 (히스토리 오염 방지)
          history.pop();
          throw innerError;
        }
      } catch (error) {
        console.error("Photo error:", error);
        await ctx.reply("사진 분석 중 오류가 발생했어.");
      }
    });
  });

  // 일반 메시지 처리
  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const userMessage = ctx.message.text;

    // 빈 메시지 무시
    if (!userMessage.trim()) return;

    await runWithChatId(chatId, async () => {
      // Heartbeat 마지막 대화 시간 업데이트
      updateLastMessageTime(chatId);

      const history = getHistory(chatId);
      const modelId = getModel(chatId);

      await ctx.replyWithChatAction("typing");

      // URL 감지 및 내용 가져오기 (병렬 처리)
      const urls = extractUrls(userMessage);
      let enrichedMessage = userMessage;

      if (urls.length > 0) {
        const urlsToFetch = urls.slice(0, 3); // 최대 3개 URL
        const contents = await Promise.all(
          urlsToFetch.map((url) => fetchWebContent(url))
        );

        const webContents = contents
          .map((content, index) => {
            if (!content) return null;
            return `\n\n---\n📎 Link: ${urlsToFetch[index]}\n📌 Title: ${content.title}\n📄 Content:\n${content.content}\n---`;
          })
          .filter((item): item is string => item !== null);

        if (webContents.length > 0) {
          enrichedMessage = userMessage + webContents.join("\n");
        }
      }

      // 사용자 메시지 추가 (URL 내용 포함)
      history.push({ role: "user", content: enrichedMessage });

      try {
        const systemPrompt = await buildSystemPrompt(modelId, history);
        
        // 스트리밍 응답 사용 (실시간 업데이트)
        const response = await sendStreamingResponse(
          ctx,
          history,
          systemPrompt,
          modelId
        );

        history.push({ role: "assistant", content: response });

        // 토큰 기반 히스토리 트리밍
        trimHistoryByTokens(history);
      } catch (error) {
        // 에러 시 방금 추가한 사용자 메시지 롤백 (히스토리 오염 방지)
        history.pop();
        console.error("Chat error:", error);
        await ctx.reply("뭔가 잘못됐어. 다시 시도해줄래?");
      }
    });
  });
}
