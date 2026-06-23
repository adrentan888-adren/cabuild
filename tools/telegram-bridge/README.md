# Local Telegram Bridge

This is a local polling bridge for this Codex workspace.

It is not a live MCP tool inside an already-running Codex session. It gives Telegram a local queue that Codex can inspect from this workspace:

- Incoming Telegram messages are stored in `data/telegram-inbox.json`.
- Replies can be placed in `data/telegram-outbox.json`.
- The script sends outbox replies and clears successful entries.

Required environment variables:

```powershell
$env:TELEGRAM_BOT_TOKEN = "..."
$env:TELEGRAM_ALLOWED_USER_IDS = "1151114885"
node tools/telegram-bridge/telegram-bridge.mjs
```

The `data/*.json` files are ignored by git.
