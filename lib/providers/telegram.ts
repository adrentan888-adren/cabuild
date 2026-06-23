const telegramBase = "https://api.telegram.org";

function botToken() {
  return process.env.TELEGRAM_BOT_TOKEN || "";
}

export function hasTelegramBot() {
  return Boolean(botToken());
}

export async function sendTelegramMessage(chatId: number | string, text: string) {
  const token = botToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  const res = await fetch(`${telegramBase}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 3900),
      parse_mode: "Markdown",
      disable_web_page_preview: true
    })
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Telegram sendMessage failed with HTTP ${res.status}: ${body.slice(0, 180)}`);
  return JSON.parse(body);
}
