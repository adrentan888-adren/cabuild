import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const dataDir = path.join(root, "data");
const inboxPath = path.join(dataDir, "telegram-inbox.json");
const statePath = path.join(dataDir, "telegram-codex-runner-state.json");
const appDataPath = path.join(dataDir, "app.json");
const handoffPath = path.join(root, "PROJECT_HANDOFF.md");

const token = process.env.TELEGRAM_BOT_TOKEN;
const allowedUsers = new Set((process.env.TELEGRAM_ALLOWED_USER_IDS || "").split(",").map((item) => item.trim()).filter(Boolean));
const pollMs = Number(process.env.TELEGRAM_CODEX_RUNNER_POLL_MS || 5000);
const timeoutMs = Number(process.env.TELEGRAM_CODEX_RUNNER_TIMEOUT_MS || 30 * 60 * 1000);
const skipExisting = process.env.TELEGRAM_CODEX_SKIP_EXISTING === "1";
const dryRun = process.env.TELEGRAM_CODEX_DRY_RUN === "1";
const codexPath = process.env.CODEX_CLI_PATH || path.join(process.env.APPDATA || "", "npm", "node_modules", "@openai", "codex", "bin", "codex.js");

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

async function readText(file, fallback = "") {
  try {
    return await readFile(file, "utf8");
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

async function sendTelegram(chatId, text) {
  const chunks = String(text || "").match(/[\s\S]{1,3800}/g) || ["Done."];
  for (const chunk of chunks) {
    await telegram("sendMessage", {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true
    });
  }
}

function redact(text) {
  return String(text || "")
    .replace(/(ghp|github_pat|dop_v1|apify_api|cfut|sk|ya29|xoxb|AIza|eyJ)[A-Za-z0-9_\-.:]{12,}/g, "[REDACTED_TOKEN]")
    .replace(/Bearer\s+[A-Za-z0-9_\-.:]{12,}/gi, "Bearer [REDACTED_TOKEN]");
}

function summarizeAppState(db) {
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
      approvedTopics: persona.approvedTopics,
      updatedAt: persona.updatedAt
    },
    counts: {
      briefs: db?.briefs?.length || 0,
      assets: db?.assets?.length || 0,
      publishQueue: db?.publishQueue?.length || 0
    },
    latestLogs: (db?.debugLogs || []).slice(-5).map((log) => ({
      action: log.action,
      label: log.label,
      status: log.status,
      provider: log.provider,
      error: log.error
    }))
  };
}

async function claimNextMessage() {
  const inbox = await readJson(inboxPath, []);
  if (!Array.isArray(inbox)) return null;
  const index = inbox.findIndex((item) => item?.status === "new" && (!allowedUsers.size || allowedUsers.has(String(item.userId))));
  if (index < 0) return null;
  const message = {
    ...inbox[index],
    status: "processing",
    processingStartedAt: new Date().toISOString()
  };
  inbox[index] = message;
  await writeJson(inboxPath, inbox);
  return message;
}

async function updateMessage(id, patch) {
  const inbox = await readJson(inboxPath, []);
  if (!Array.isArray(inbox)) return;
  const index = inbox.findIndex((item) => item?.id === id);
  if (index < 0) return;
  inbox[index] = { ...inbox[index], ...patch };
  await writeJson(inboxPath, inbox);
}

async function skipExistingMessages() {
  const state = await readJson(statePath, {});
  if (state.initializedAt || !skipExisting) return;
  const inbox = await readJson(inboxPath, []);
  let skipped = 0;
  if (Array.isArray(inbox)) {
    for (const item of inbox) {
      if (item?.status === "new") {
        item.status = "skipped-before-runner-start";
        item.skippedAt = new Date().toISOString();
        skipped += 1;
      }
    }
    await writeJson(inboxPath, inbox);
  }
  await writeJson(statePath, { initializedAt: new Date().toISOString(), skippedExisting: skipped });
  console.log(`Telegram Codex runner skipped ${skipped} existing message(s).`);
}

async function buildPrompt(message) {
  const appState = summarizeAppState(await readJson(appDataPath, {}));
  const handoff = (await readText(handoffPath)).slice(-16000);
  return `You are Codex running as the always-on Telegram agent for the ContentAgent Social project.

You are handling a Telegram message from the allowed project owner. Treat it as the user's latest request.

Operating rules:
- You may inspect files, edit code, run tests/builds, commit, push, deploy, and run local commands when the Telegram request asks for it.
- Do not wait for an extra /do command.
- Be careful with credentials: never print or send secrets, tokens, API keys, passwords, or raw .env contents.
- Preserve user data and generated history unless the Telegram request explicitly asks to delete it.
- Update PROJECT_HANDOFF.md for project changes so future sessions understand what changed.
- If you make code changes, run appropriate verification when feasible.
- Final answer must be concise and suitable for Telegram. Include what changed, verification, and commit/deploy info if relevant.

Project root:
${root}

Recent project handoff:
${handoff}

Current app state summary:
${JSON.stringify(appState, null, 2)}

Telegram message metadata:
${JSON.stringify({
    id: message.id,
    username: message.username,
    firstName: message.firstName,
    receivedAt: message.receivedAt
  }, null, 2)}

Telegram user message:
${message.text}
`;
}

async function runCodex(message) {
  if (dryRun) return `Dry run: Codex runner received "${message.text}"`;

  const outputPath = path.join(os.tmpdir(), `telegram-codex-${message.id}-${Date.now()}.txt`);
  const prompt = await buildPrompt(message);
  const args = [
    codexPath,
    "exec",
    "--cd",
    root,
    "--dangerously-bypass-approvals-and-sandbox",
    "--output-last-message",
    outputPath,
    "-"
  ];

  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Codex timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.stdin.end(prompt);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      const finalMessage = (await readText(outputPath)).trim();
      if (code !== 0) {
        reject(new Error(`Codex exited with code ${code}. ${stderr.slice(-1200)}`));
        return;
      }
      resolve(finalMessage || "Codex completed the request but did not return a final message.");
    });
  });
}

async function processOnce() {
  const message = await claimNextMessage();
  if (!message) return;

  console.log(`Processing Telegram message ${message.id}: ${message.text.slice(0, 80)}`);
  await sendTelegram(message.chatId, "Codex is working on this now. I will reply here when it is done.");

  try {
    const answer = redact(await runCodex(message));
    await sendTelegram(message.chatId, answer);
    await updateMessage(message.id, {
      status: "replied",
      repliedAt: new Date().toISOString(),
      replyPreview: answer.slice(0, 500)
    });
  } catch (error) {
    const text = redact(error instanceof Error ? error.message : String(error));
    await sendTelegram(message.chatId, `Codex runner failed: ${text}`);
    await updateMessage(message.id, {
      status: "failed",
      failedAt: new Date().toISOString(),
      error: text.slice(0, 1000)
    });
  }
}

await skipExistingMessages();
console.log(`Telegram Codex runner running. Inbox: ${inboxPath}`);

for (;;) {
  try {
    await processOnce();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  }
  await new Promise((resolve) => setTimeout(resolve, pollMs));
}
