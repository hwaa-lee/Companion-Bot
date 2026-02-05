import { createBot } from "./telegram/bot.js";
import { getSecret } from "./config/secrets.js";

async function main() {
  const token = await getSecret("telegram-token");
  const apiKey = await getSecret("anthropic-api-key");

  if (!token) {
    console.error("Error: Telegram Bot Token이 설정되지 않았습니다.");
    console.error("실행: npm run setup telegram");
    process.exit(1);
  }

  if (!apiKey) {
    console.error("Error: Anthropic API Key가 설정되지 않았습니다.");
    console.error("실행: npm run setup anthropic");
    process.exit(1);
  }

  // Anthropic SDK는 환경변수에서 API 키를 읽음
  process.env.ANTHROPIC_API_KEY = apiKey;

  const bot = createBot(token);

  console.log("Starting CompanionBot...");
  bot.start();
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
