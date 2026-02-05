import type { ModelId } from "../ai/claude.js";
import type { Message } from "../ai/claude.js";

// 세션별 상태 저장
const sessions = new Map<number, Message[]>();
const sessionModels = new Map<number, ModelId>();

export function getHistory(chatId: number): Message[] {
  let history = sessions.get(chatId);
  if (!history) {
    history = [];
    sessions.set(chatId, history);
  }
  return history;
}

export function clearHistory(chatId: number): void {
  sessions.delete(chatId);
}

export function getModel(chatId: number): ModelId {
  return sessionModels.get(chatId) || "sonnet";
}

export function setModel(chatId: number, modelId: ModelId): void {
  sessionModels.set(chatId, modelId);
}

// 현재 활성 chatId (도구에서 사용)
let currentChatId: number | null = null;

export function setCurrentChatId(chatId: number): void {
  currentChatId = chatId;
}

export function getCurrentChatId(): number | null {
  return currentChatId;
}
