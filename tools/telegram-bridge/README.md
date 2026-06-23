# Local Telegram Bridge

This is a local polling bridge for this Codex workspace.

It gives Telegram a local queue and an optional Codex runner:

- Incoming Telegram messages are stored in `data/telegram-inbox.json`.
- Slash commands such as `/status`, `/logs`, and `/persona` are answered by the bridge.
- Normal messages can be processed by `telegram-codex-runner.mjs`, which launches `codex exec`.
- Manual replies can still be placed in `data/telegram-outbox.json`.
- The script sends outbox replies and clears successful entries.

Required environment variables:

```powershell
$env:TELEGRAM_BOT_TOKEN = "..."
$env:TELEGRAM_ALLOWED_USER_IDS = "1151114885"
node tools/telegram-bridge/telegram-bridge.mjs
```

Start the Codex runner in a second process:

```powershell
$env:TELEGRAM_BOT_TOKEN = "..."
$env:TELEGRAM_ALLOWED_USER_IDS = "1151114885"
$env:TELEGRAM_CODEX_SKIP_EXISTING = "1"
node tools/telegram-bridge/telegram-codex-runner.mjs
```

The runner uses the locally authenticated Codex CLI and can edit, run commands, commit, push, or deploy when the Telegram request asks for it.

The `data/*.json` files are ignored by git.
