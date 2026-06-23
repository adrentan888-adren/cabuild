# Telegram Local Bridge Setup

This project includes a local Telegram bridge for Codex sessions.

It lets Telegram messages reach this workspace through local JSON queues and optional auto-replies. It does **not** directly control a Codex runtime. A Codex session can inspect the inbox, act on messages, and reply through the bridge.

## Files

- Bridge script: `tools/telegram-bridge/telegram-bridge.mjs`
- Bridge notes: `tools/telegram-bridge/README.md`
- Incoming messages: `data/telegram-inbox.json`
- Outgoing replies: `data/telegram-outbox.json`
- Polling state: `data/telegram-bridge-state.json`

The `data/*.json` files are ignored by git.

## Current Bot

- Bot username: `@CAbuildbot`
- Allowed Telegram user ID: `1151114885`

The bot token was shared in chat and should be rotated in BotFather before production use.

## Environment Variables

Set these in the shell before starting the bridge:

```powershell
$env:TELEGRAM_BOT_TOKEN = "your-telegram-bot-token"
$env:TELEGRAM_ALLOWED_USER_IDS = "1151114885"
$env:KIE_API_TOKEN = "your-kie-token"
```

`KIE_API_TOKEN` is optional for command replies, but required for GPT-5.5 answers to free-text messages.

## Start Bridge

From the project root:

```powershell
node tools/telegram-bridge/telegram-bridge.mjs
```

To start hidden in the background:

```powershell
$env:TELEGRAM_BOT_TOKEN = "your-telegram-bot-token"
$env:TELEGRAM_ALLOWED_USER_IDS = "1151114885"
$env:KIE_API_TOKEN = "your-kie-token"
Start-Process -FilePath "node.exe" -ArgumentList "tools/telegram-bridge/telegram-bridge.mjs" -WorkingDirectory "C:\Users\WINDOWS-10\Desktop\ClaudeWork\CABuild" -WindowStyle Hidden
```

## Check Bridge Process

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -match "telegram-bridge" } |
  Select-Object ProcessId,CommandLine
```

## Stop Bridge

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -match "telegram-bridge" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

## How It Works

Telegram messages from allowed users are polled with `getUpdates`.

For each message:

1. The bridge saves it to `data/telegram-inbox.json`.
2. If it is a command, the bridge replies directly.
3. If it is normal text and `KIE_API_TOKEN` is set, the bridge asks Kie GPT-5.5 for a concise project-aware answer.
4. A Codex session can still read the inbox for follow-up implementation work.

Supported commands:

- `/start`
- `/help`
- `/status`
- `/logs`
- `/persona`

## Manual Replies

To send a manual reply through the bridge, add an item to `data/telegram-outbox.json`:

```json
[
  {
    "chatId": 1151114885,
    "text": "Reply text here"
  }
]
```

The bridge will send it and clear successful entries.

## Future Session Checklist

1. Pull latest repo.
2. Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS`, and `KIE_API_TOKEN`.
3. Start `tools/telegram-bridge/telegram-bridge.mjs`.
4. Send `/status` to `@CAbuildbot`.
5. Confirm the message appears in `data/telegram-inbox.json`.

## Limitation

This bridge does not inject messages directly into the Codex UI. It is a local bridge plus queue and auto-answer service. For code changes, a Codex session still needs to read the inbox and perform the work.
