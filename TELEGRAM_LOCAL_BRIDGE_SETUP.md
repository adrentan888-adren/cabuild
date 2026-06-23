# Telegram Local Bridge Setup

This project includes a local Telegram bridge for Codex sessions.

It lets Telegram messages reach this workspace through local JSON queues. It does **not** directly control a Codex runtime. A Codex session can inspect the inbox, act on messages, and reply through the bridge.

## Files

- Bridge script: `tools/telegram-bridge/telegram-bridge.mjs`
- Bridge notes: `tools/telegram-bridge/README.md`
- Incoming messages: `data/telegram-inbox.json`
- Outgoing replies: `data/telegram-outbox.json`
- Polling state: `data/telegram-bridge-state.json`

The `data/*.json` files are ignored by git.

## Bot Details

- Bot username: replace with the bot created in BotFather.
- Allowed Telegram user ID: replace with the user ID that should be allowed to use the bridge.

Do not commit bot tokens or user-specific secrets. If a token is pasted into chat or logs, rotate it in BotFather.

## Environment Variables

Set these in the shell before starting the bridge:

```powershell
$env:TELEGRAM_BOT_TOKEN = "your-telegram-bot-token"
$env:TELEGRAM_ALLOWED_USER_IDS = "your-telegram-user-id"
```

No AI provider key is required. The bridge receives messages, saves them to the inbox, processes fixed commands, and sends manual outbox replies written by the Codex session.

## Start Bridge

From the project root:

```powershell
node tools/telegram-bridge/telegram-bridge.mjs
```

To start hidden in the background:

```powershell
$env:TELEGRAM_BOT_TOKEN = "your-telegram-bot-token"
$env:TELEGRAM_ALLOWED_USER_IDS = "your-telegram-user-id"
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
3. If it is normal text, the bridge acknowledges it and keeps it in the inbox for the Codex session to answer or act on.
4. A Codex session can write replies to the outbox.

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
    "chatId": 123456789,
    "text": "Reply text here"
  }
]
```

The bridge will send it and clear successful entries.

## Future Session Checklist

1. Pull latest repo.
2. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_USER_IDS`.
3. Start `tools/telegram-bridge/telegram-bridge.mjs`.
4. Send `/status` to the configured Telegram bot.
5. Confirm the message appears in `data/telegram-inbox.json`.

## Limitation

This bridge does not inject messages directly into the Codex UI. It is a local bridge plus queue and auto-answer service. For code changes, a Codex session still needs to read the inbox and perform the work.
