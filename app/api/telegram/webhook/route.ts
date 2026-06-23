import { NextResponse } from "next/server";
import { readDb } from "@/lib/store";
import { generateTelegramReplyWithGpt55 } from "@/lib/providers/kie";
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
    `Name: ${persona.fullName || persona.preferredName || "not set"}`,
    `Role: ${persona.jobTitle || "not set"}`,
    `Company: ${persona.company || "not set"}`,
    `Audience: ${persona.primaryAudience || "not set"}`,
    `Topics: ${(persona.approvedTopics || []).join(", ") || "not set"}`
  ].join("\n");
}

async function answer(text: string) {
  const snapshot = await projectSnapshot();
  const command = text.trim().toLowerCase();
  if (command === "/start" || command === "/help") {
    return [
      "ContentAgent Telegram bridge is connected.",
      "",
      "Commands:",
      "/status - app status",
      "/logs - latest debug logs",
      "/persona - current persona",
      "",
      "You can also ask a project question in plain text."
    ].join("\n");
  }
  if (command === "/status") return statusText(snapshot);
  if (command === "/logs") return logsText(snapshot);
  if (command === "/persona") return personaText(snapshot);

  const prompt = `You are the ContentAgent project assistant inside a Telegram bot.
Answer concisely and pragmatically. You can explain current project state, suggest next steps, and reference available app data.
Do not claim you can edit code or deploy from Telegram directly. If the user asks for code changes, say they should keep using the Codex session for implementation until a full Telegram job runner is added.

Project snapshot:
${JSON.stringify(snapshot, null, 2).slice(0, 12000)}

User Telegram message:
${text}`;
  return generateTelegramReplyWithGpt55(prompt);
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
