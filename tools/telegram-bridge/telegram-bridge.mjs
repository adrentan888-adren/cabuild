import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dataDir = path.join(root, "data");
const inboxPath = path.join(dataDir, "telegram-inbox.json");
const outboxPath = path.join(dataDir, "telegram-outbox.json");
const statePath = path.join(dataDir, "telegram-bridge-state.json");
const appDataPath = path.join(dataDir, "app.json");

const token = process.env.TELEGRAM_BOT_TOKEN;
const allowedUsers = new Set((process.env.TELEGRAM_ALLOWED_USER_IDS || "").split(",").map((item) => item.trim()).filter(Boolean));
const pollMs = Number(process.env.TELEGRAM_POLL_MS || 3000);

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is required.");
  process.exit(1);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, file);
}

async function telegram(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { ok: false, description: text };
  }
  if (!res.ok || !json.ok) throw new Error(`${method} failed: ${json.description || res.status}`);
  return json.result;
}

function compactProjectState(db) {
  const workspace = db?.workspaces?.[0] || {};
  const persona = (db?.personaProfiles || []).find((item) => item.workspaceId === workspace.id) || {};
  return {
    workspace: {
      name: workspace.name,
      niche: workspace.niche,
      credits: workspace.credits
    },
    persona: {
      fullName: persona.fullName,
      jobTitle: persona.jobTitle,
      company: persona.company,
      primaryAudience: persona.primaryAudience,
      approvedTopics: persona.approvedTopics
    },
    counts: {
      briefs: db?.briefs?.length || 0,
      assets: db?.assets?.length || 0,
      publishQueue: db?.publishQueue?.length || 0,
      done: (db?.publishQueue || []).filter((item) => item.status === "done").length,
      generating: (db?.publishQueue || []).filter((item) => item.status === "generating").length,
      failed: (db?.publishQueue || []).filter((item) => item.status === "failed").length
    },
    latestActivity: (db?.activity || []).slice(-5),
    latestLogs: (db?.debugLogs || []).slice(-5).map((log) => ({
      action: log.action,
      label: log.label,
      status: log.status,
      provider: log.provider,
      error: log.error
    }))
  };
}

function commandReply(text, state) {
  const command = text.trim().toLowerCase();
  if (command === "/start" || command === "/help") {
    return [
      "ContentAgent local bridge is connected.",
      "",
      "Commands:",
      "/status - app status",
      "/logs - latest debug logs",
      "/persona - current persona",
      "",
      "Plain text messages are queued for the Codex session to process."
    ].join("\n");
  }
  if (command === "/status") {
    return [
      `${state.workspace.name || "ContentAgent"}`,
      `Niche: ${state.workspace.niche || "not set"}`,
      `Credits: ${state.workspace.credits ?? "n/a"}`,
      `Briefs: ${state.counts.briefs}`,
      `Assets: ${state.counts.assets}`,
      `Publish queue: ${state.counts.publishQueue}`,
      `Done: ${state.counts.done} | Generating: ${state.counts.generating} | Failed: ${state.counts.failed}`
    ].join("\n");
  }
  if (command === "/persona") {
    return [
      "Persona",
      `Name: ${state.persona.fullName || "not set"}`,
      `Role: ${state.persona.jobTitle || "not set"}`,
      `Company: ${state.persona.company || "not set"}`,
      `Audience: ${state.persona.primaryAudience || "not set"}`,
      `Topics: ${(state.persona.approvedTopics || []).join(", ") || "not set"}`
    ].join("\n");
  }
  if (command === "/logs") {
    return state.latestLogs.length
      ? state.latestLogs.map((log) => `${log.status} ${log.action}\n${log.label}${log.error ? `\nError: ${log.error}` : ""}`).join("\n\n")
      : "No debug logs yet.";
  }
  return "";
}

async function bridgeReply(text) {
  const db = await readJson(appDataPath, {});
  const state = compactProjectState(db);
  const command = commandReply(text, state);
  if (command) return command;
  return "";
}

async function appendInbox(messages) {
  if (!messages.length) return;
  const inbox = await readJson(inboxPath, []);
  inbox.push(...messages);
  await writeJson(inboxPath, inbox.slice(-250));
}

async function flushOutbox() {
  const outbox = await readJson(outboxPath, []);
  if (!Array.isArray(outbox) || outbox.length === 0) return;
  const remaining = [];
  for (const item of outbox) {
    try {
      if (!item?.chatId || !item?.text) continue;
      await telegram("sendMessage", {
        chat_id: item.chatId,
        text: String(item.text).slice(0, 3900),
        disable_web_page_preview: true
      });
    } catch (error) {
      remaining.push({ ...item, lastError: error instanceof Error ? error.message : String(error) });
    }
  }
  await writeJson(outboxPath, remaining);
}

async function pollOnce() {
  const state = await readJson(statePath, { offset: 0 });
  const updates = await telegram("getUpdates", {
    offset: state.offset || 0,
    timeout: 25,
    allowed_updates: ["message"]
  });
  let nextOffset = state.offset || 0;
  const accepted = [];
  for (const update of updates) {
    nextOffset = Math.max(nextOffset, update.update_id + 1);
    const message = update.message;
    const text = message?.text?.trim();
    const userId = message?.from?.id ? String(message.from.id) : "";
    if (!message || !text) continue;
    if (allowedUsers.size && !allowedUsers.has(userId)) {
      await telegram("sendMessage", { chat_id: message.chat.id, text: "Unauthorized Telegram user." });
      continue;
    }
    const reply = await bridgeReply(text);
    accepted.push({
      id: update.update_id,
      chatId: message.chat.id,
      userId,
      username: message.from?.username || "",
      firstName: message.from?.first_name || "",
      text,
      receivedAt: new Date().toISOString(),
      status: reply ? "bridge-replied" : "new",
      bridgeRepliedAt: reply ? new Date().toISOString() : undefined
    });
    if (reply) {
      await telegram("sendMessage", {
        chat_id: message.chat.id,
        text: reply,
        disable_web_page_preview: true
      });
    }
  }
  await writeJson(statePath, { offset: nextOffset, updatedAt: new Date().toISOString() });
  await appendInbox(accepted);
  await flushOutbox();
  if (accepted.length) console.log(`Stored ${accepted.length} Telegram message(s).`);
}

console.log(`Telegram local bridge running. Inbox: ${inboxPath}`);
for (;;) {
  try {
    await pollOnce();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    await new Promise((resolve) => setTimeout(resolve, Math.max(5000, pollMs)));
  }
  await new Promise((resolve) => setTimeout(resolve, pollMs));
}
