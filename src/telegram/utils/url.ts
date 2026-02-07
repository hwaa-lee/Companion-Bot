import * as cheerio from "cheerio";

/**
 * 텍스트에서 URL을 추출합니다.
 */
export function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
  return text.match(urlRegex) || [];
}

/**
 * URL 안전성 검사 (SSRF 방지)
 */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    // HTTP/HTTPS만 허용
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    // 로컬/내부 네트워크 차단
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname === "169.254.169.254" || // AWS/Cloud metadata
      (hostname.endsWith(".amazonaws.com") && hostname.includes("metadata"))
    ) {
      return false;
    }

    // 172.16.0.0/12 (172.16.x.x ~ 172.31.x.x) 정확히 차단
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * 웹페이지 내용을 가져옵니다.
 */
export async function fetchWebContent(
  url: string
): Promise<{ title: string; content: string } | null> {
  // SSRF 방지
  if (!isSafeUrl(url)) {
    console.log(`[Security] Blocked unsafe URL: ${url}`);
    return null;
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CompanionBot/1.0)",
      },
    });

    if (!response.ok) return null;

    const html = await response.text();
    const $ = cheerio.load(html);

    // 불필요한 요소 제거
    $(
      "script, style, nav, footer, header, aside, .ad, .advertisement"
    ).remove();

    // 제목 추출
    const title =
      $("title").text().trim() || $("h1").first().text().trim() || "제목 없음";

    // 본문 추출 (article, main, body 순으로 시도)
    const mainContent =
      $("article").text() ||
      $("main").text() ||
      $(".content").text() ||
      $("body").text();

    // 텍스트 정리
    const content = mainContent
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 5000); // 5000자로 제한

    return { title, content };
  } catch (error) {
    console.error("Fetch error:", error);
    return null;
  }
}
