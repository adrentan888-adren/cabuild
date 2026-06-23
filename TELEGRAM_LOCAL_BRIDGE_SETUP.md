# Telegram Local Bridge Setup

This project includes a local Telegram bridge for Codex sessions.

The original repo-local bridge remains available as a fallback. The current live machine has been switched to the external `op7418/Claude-to-IM-skill` bridge with `CTI_RUNTIME=codex`.

The repo-local bridge lets Telegram messages reach this workspace through local JSON queues. It does **not** directly control a Codex runtime unless `telegram-codex-runner.mjs` is also running.

The external Claude-to-IM bridge runs from:

```text
C:\Users\WINDOWS-10\.codex\skills\claude-to-im
```

Its private config is:

```text
C:\Users\WINDOWS-10\.claude-to-im\config.env
```

Do not commit that config file or paste its token values.

To check the external bridge:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -match "dist/daemon.mjs" } |
  Select-Object ProcessId,CommandLine

Get-Content "$env:USERPROFILE\.claude-to-im\runtime\status.json"
```

To stop it:

```powershell
$pidFile = "$env:USERPROFILE\.claude-to-im\runtime\bridge.pid"
if (Test-Path $pidFile) {
  Stop-Process -Id ([int](Get-Content $pidFile -Raw).Trim()) -Force
  Remove-Item $pidFile -Force
}
```

To start it manually after a reboot:

```powershell
$env:CTI_HOME = "$env:USERPROFILE\.claude-to-im"
Start-Process -FilePath "node.exe" `
  -ArgumentList "dist/daemon.mjs" `
  -WorkingDirectory "C:\Users\WINDOWS-10\.codex\skills\claude-to-im" `
  -WindowStyle Hidden `
  -RedirectStandardOutput "$env:USERPROFILE\.claude-to-im\logs\bridge.out.log" `
  -RedirectStandardError "$env:USERPROFILE\.claude-to-im\logs\bridge.err.log"
```

## Files

- Bridge script: `tools/telegram-bridge/telegram-bridge.mjs`
- Codex runner: `tools/telegram-bridge/telegram-codex-runner.mjs`
- Bridge notes: `tools/telegram-bridge/README.md`
- Incoming messages: `data/telegram-inbox.json`
- Outgoing replies: `data/telegram-outbox.json`
- Polling state: `data/telegram-bridge-state.json`
- Runner state: `data/telegram-codex-runner-state.json`

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

The optional Codex runner uses the locally authenticated Codex CLI. It does not need a separate model API key, but the machine must already be logged in to Codex.

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

## Start Codex Runner

Start this as a second process if Telegram should run Codex automatically for normal messages:

```powershell
$env:TELEGRAM_BOT_TOKEN = "your-telegram-bot-token"
$env:TELEGRAM_ALLOWED_USER_IDS = "your-telegram-user-id"
$env:TELEGRAM_CODEX_SKIP_EXISTING = "1"
Start-Process -FilePath "node.exe" -ArgumentList "tools/telegram-bridge/telegram-codex-runner.mjs" -WorkingDirectory "C:\Users\WINDOWS-10\Desktop\ClaudeWork\CABuild" -WindowStyle Hidden
```

`TELEGRAM_CODEX_SKIP_EXISTING=1` marks old unprocessed inbox messages as skipped on first runner start, so the runner only works on new Telegram messages.

The runner invokes local Codex with non-interactive permissions. It can edit files, run builds, commit, push, and deploy when the allowed Telegram user asks it to. Keep the bot private and rotate any token pasted into chat or logs.

## Check Bridge Process

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -match "telegram-bridge" } |
  Select-Object ProcessId,CommandLine
```

Check the runner process:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -match "telegram-codex-runner" } |
  Select-Object ProcessId,CommandLine
```

## Stop Bridge

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -match "telegram-bridge" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

Stop the runner:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -match "telegram-codex-runner" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

## How It Works

Telegram messages from allowed users are polled with `getUpdates`.

For each message:

1. The bridge saves it to `data/telegram-inbox.json`.
2. If it is a command, the bridge replies directly.
3. If it is normal text, the Codex runner marks it processing, sends a working acknowledgement, launches `codex exec`, and sends the final answer back to Telegram.
4. A Codex session can still write manual replies to the outbox.

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
4. Start `tools/telegram-bridge/telegram-codex-runner.mjs` if automatic Codex processing is needed.
5. Send `/status` to the configured Telegram bot.
6. Send a normal text message and confirm the runner replies after Codex completes.

## Limitation

The runner starts separate non-interactive Codex jobs. It does not inject messages into an already-open Codex UI session.
