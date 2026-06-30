import { NextResponse } from "next/server";
import { readDb } from "@/lib/store";
import { sendTelegramMessage } from "@/lib/providers/telegram";

type TelegramUpdate = {
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number; type: string };
    from?: { id: number; username?: string; first_name?: string };
  };
};

function allowedUserIds() {
  return (process.env.TELEGRAM_ALLOWED_USER_IDS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isAllowed(userId?: number) {
  const allowed = allowedUserIds();
  return Boolean(userId && allowed.includes(String(userId)));
}

async function projectSnapshot() {
  const db = await readDb();
  const workspace = db.workspaces[0];
  const persona = db.personaProfiles.find((item) => item.workspaceId === workspace?.id);
  const latestLogs = (db.debugLogs || []).slice(-5).reverse();
  return {
    workspace,
    persona,
    counts: {
      briefs: db.briefs.length,
      assets: db.assets.length,
      publishQueue: db.publishQueue.length,
      done: db.publishQueue.filter((item) => item.status === "done").length,
      generating: db.publishQueue.filter((item) => item.status === "generating").length,
      failed: db.publishQueue.filter((item) => item.status === "failed").length
    },
    latestLogs
  };
}

function statusText(snapshot: Awaited<ReturnType<typeof projectSnapshot>>) {
  return [
    `*${snapshot.workspace?.name || "ContentAgent"}*`,
    `Niche: ${snapshot.workspace?.niche || "not set"}`,
    `Credits: ${snapshot.workspace?.credits ?? "n/a"}`,
    "",
    `Briefs: ${snapshot.counts.briefs}`,
    `Assets: ${snapshot.counts.assets}`,
    `Publish queue: ${snapshot.counts.publishQueue}`,
    `Done: ${snapshot.counts.done} | Generating: ${snapshot.counts.generating} | Failed: ${snapshot.counts.failed}`
  ].join("\n");
}

function logsText(snapshot: Awaited<ReturnType<typeof projectSnapshot>>) {
  if (!snapshot.latestLogs.length) return "No debug logs yet.";
  return snapshot.latestLogs
    .map((log) => `*${log.status}* ${log.action}\n${log.label}${log.error ? `\nError: ${log.error}` : ""}`)
    .join("\n\n");
}

function personaText(snapshot: Awaited<ReturnType<typeof projectSnapshot>>) {
  const persona = snapshot.persona;
  if (!persona) return "No persona profile found.";
  return [
    "*Persona*",
    `Name: ${persona.displayName || "not set"}`,
    `Role: ${persona.role || "not set"}`,
    `Company: ${persona.company || "not set"}`,
    `Audience: ${persona.primaryAudience || "not set"}`,
    `Topics: ${(persona.approvedTopics || []).join(", ") || "not set"}`
  ].join("\n");
}

async function answer(text: string) {
  const snapshot = await projectSnapshot();
  const command = text.trim().toLowerCase();
  const compact = command.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  if (command === "/start" || command === "/help") {
    return [
      "ContentAgent Telegram bridge is connected.",
      "",
      "Commands:",
      "/status - app status",
      "/logs - latest debug logs",
      "/persona - current persona",
      "",
      "Plain text messages should be handled by the Codex session/local bridge."
    ].join("\n");
  }
  if (command === "/status" || compact.includes("status") || compact.includes("summary") || compact.includes("how is the app")) return statusText(snapshot);
  if (command === "/logs" || compact.includes("log") || compact.includes("debug")) return logsText(snapshot);
  if (command === "/persona" || compact.includes("persona") || compact.includes("profile")) return personaText(snapshot);
  if (["hi", "hello", "hey", "ok", "okay"].includes(compact)) {
    return "Hi. You can ask for persona, status, logs, or where to find a page in the web app. For build/change requests, I will save the message for the active Codex session.";
  }
  if (compact.includes("where") || compact.includes("webgui") || compact.includes("web gui") || compact.includes("button") || compact.includes("click")) {
    if (compact.includes("persona") || compact.includes("profile")) {
      return [
        "Persona is in the web app in two places:",
        "1. Left sidebar: click Persona.",
        "2. Bottom-left user pill: click the Sean Tan profile button, then choose Persona from the drop-up menu.",
        "",
        "I am preparing screenshot steps in the Codex session now."
      ].join("\n");
    }
    return "In the web app, use the left sidebar for main pages. The bottom-left user pill opens Settings and Persona.";
  }

  return [
    "I can answer local project questions like persona, status, logs, or where to click in the web app.",
    "For open-ended build/change requests, I saved your Telegram message in the Codex inbox so the active session can handle it."
  ].join("\n");
}

export async function POST(req: Request) {
  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const message = update.message;
  const text = message?.text?.trim();
  const chatId = message?.chat.id;
  const userId = message?.from?.id;
  if (!message || !text || !chatId) return NextResponse.json({ ok: true });

  if (!isAllowed(userId)) {
    await sendTelegramMessage(chatId, "Unauthorized Telegram user.");
    return NextResponse.json({ ok: true });
  }

  try {
    await sendTelegramMessage(chatId, await answer(text));
  } catch (error) {
    await sendTelegramMessage(chatId, error instanceof Error ? error.message : "Telegram bridge failed.");
  }
  return NextResponse.json({ ok: true });
}
