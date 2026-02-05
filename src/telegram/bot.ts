import { Bot } from "grammy";
import { chat, MODELS, type Message, type ModelId } from "../ai/claude.js";
import {
  getHistory,
  clearHistory,
  getModel,
  setModel,
  setCurrentChatId,
} from "../session/state.js";

function getSystemPrompt(modelId: ModelId): string {
  const model = MODELS[modelId];
  return `You are CompanionBot, powered by ${model.name} (${model.id}).

You can:
- Read files: Use read_file to view code, documents, or any text file
- Write files: Use write_file to create or modify files
- List directories: Use list_directory to explore folder structures
- Run commands: Use run_command for git, npm, and other safe commands
- Change model: Use change_model to switch AI models

Allowed directories: /Users/hwai/Documents, /Users/hwai/projects

Current model: ${model.name}
Available models:
- sonnet: Claude Sonnet 4 (balanced, default)
- opus: Claude Opus 4 (most capable, complex tasks)
- haiku: Claude Haiku 3.5 (fast, simple tasks)

You can proactively switch models when appropriate:
- Switch to opus for complex coding or deep analysis
- Switch to haiku for simple questions or casual chat
- Stay on sonnet for general tasks

When asked about yourself, tell the user you are ${model.name}.
Be helpful, concise, and use tools when needed.`;
}

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  // 에러 핸들링
  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  // /start 명령어
  bot.command("start", async (ctx) => {
    const chatId = ctx.chat.id;
    clearHistory(chatId);
    setModel(chatId, "sonnet");

    const model = MODELS["sonnet"];
    await ctx.reply(
      `Hello! I'm CompanionBot (${model.name})\n\n` +
      `Commands:\n` +
      `/clear - Start new conversation\n` +
      `/model - Change AI model\n\n` +
      `I can read/write files, run commands, and switch models automatically based on task complexity!`
    );
  });

  // /clear 명령어 - 대화 기록 초기화
  bot.command("clear", async (ctx) => {
    const chatId = ctx.chat.id;
    clearHistory(chatId);
    await ctx.reply("Conversation cleared. Let's start fresh!");
  });

  // /model 명령어 - 모델 변경
  bot.command("model", async (ctx) => {
    const chatId = ctx.chat.id;
    const arg = ctx.message.text.split(" ")[1]?.toLowerCase();

    if (!arg) {
      const currentModel = getModel(chatId);
      const modelList = Object.entries(MODELS)
        .map(([id, m]) => `${id === currentModel ? "→" : "  "} /model ${id} - ${m.name}`)
        .join("\n");

      await ctx.reply(
        `Current model: ${MODELS[currentModel].name}\n\n` +
        `Available models:\n${modelList}\n\n` +
        `Tip: You can also ask me to change models in natural language!`
      );
      return;
    }

    if (arg in MODELS) {
      const modelId = arg as ModelId;
      setModel(chatId, modelId);
      await ctx.reply(`Model changed to: ${MODELS[modelId].name}`);
    } else {
      await ctx.reply(
        `Unknown model: ${arg}\n\n` +
        `Available: sonnet, opus, haiku`
      );
    }
  });

  // 일반 메시지 처리
  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const userMessage = ctx.message.text;

    // 현재 chatId 설정 (도구에서 사용)
    setCurrentChatId(chatId);

    // 세션 가져오기
    const history = getHistory(chatId);
    const modelId = getModel(chatId);

    // 사용자 메시지 추가
    history.push({ role: "user", content: userMessage });

    // 타이핑 표시
    await ctx.replyWithChatAction("typing");

    try {
      // Claude에게 요청
      const response = await chat(history, getSystemPrompt(modelId), modelId);

      // 응답 추가
      history.push({ role: "assistant", content: response });

      // 히스토리 제한 (최근 20개 메시지만 유지)
      if (history.length > 20) {
        history.splice(0, history.length - 20);
      }

      // 응답 전송
      await ctx.reply(response);
    } catch (error) {
      console.error("Chat error:", error);
      await ctx.reply("Sorry, something went wrong. Please try again.");
    }
  });

  return bot;
}
