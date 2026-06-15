# ContentAgent Social

Full-stack Next.js prototype for the ContentAgent Social PRD. The app includes local authentication, workspace data, brand kit settings, social intelligence opportunities, brief generation, production assets, UGC generation, publishing queue, analytics, and deployment guidance.

## Run locally

```bash
npm install
npm run dev -- -p 3100
```

Demo login:

```text
demo@contentagent.tech
demo1234
```

Local data is stored in `data/app.json`. Delete that file to reset the demo seed.

## Environment variables

Copy `.env.example` to `.env.local` for local development. Keep all provider tokens server-side only.

Required before real integrations:

```text
APP_SECRET
KIE_API_TOKEN
APIFY_API_TOKEN
GITHUB_TOKEN
UPLOAD_POST_API_KEY
CLOUDFLARE_R2_ACCESS_KEY_ID
CLOUDFLARE_R2_SECRET_ACCESS_KEY
CLOUDFLARE_R2_BUCKET
CLOUDFLARE_R2_ENDPOINT
DATABASE_URL
```

## Recommended production stack

- Frontend/API: Vercel for the Next.js app.
- Database: managed PostgreSQL on Railway, Supabase, Neon, or Render.
- Workers: Railway, Fly.io, or Hetzner VPS for Celery/Redis, FFmpeg, Remotion, and Puppeteer rendering.
- Queue: Redis through Railway, Upstash, or a VPS-managed Redis.
- Storage: Cloudflare R2 for generated images, video renders, uploads, and thumbnails.
- Publishing: Upload-Post.com API or n8n node for TikTok, Instagram, LinkedIn, and Facebook.
- Billing: Stripe subscriptions plus credit ledger.
- Monitoring: Sentry for app errors and Better Stack/UptimeRobot for uptime checks.

For an early MVP, Vercel + Railway Postgres + Railway worker + Cloudflare R2 is the fastest low-ops path. Move rendering workers to a Hetzner VPS when video volume grows and Railway worker cost becomes less predictable.

## Integration notes

This prototype currently simulates Kie.ai, Apify, rendering, and publishing actions through authenticated API routes. Replace the action handlers in `app/api/social/route.ts` with service modules when you are ready to connect real providers.

Do not send API tokens through the browser. The frontend should call your own `/api/...` routes, and those routes should call Kie.ai, Apify, GitHub, Cloudflare R2, Stripe, and Upload-Post.com from the server.
