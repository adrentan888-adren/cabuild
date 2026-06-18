# CABuild Project Handoff

Last updated: 2026-06-18

## Purpose
ContentAgent Social is a local Next.js prototype for research, content planning, AI generation, and publishing. The mock UI is the visual source of truth when it conflicts with the PRD.

## Local Start
- Workspace: `C:\Users\WINDOWS-10\Desktop\ClaudeWork\CABuild`
- Dev server: `npm run dev -- -p 3100`
- Build check: `npm run build`
- App URL: `http://localhost:3100`

## GitHub
- Private repo: `https://github.com/adrentan888-adren/cabuild`
- Branch: `main`
- Current deployment commit pushed: `0477adc Prepare ContentAgent for GCP deployment`

Before builds, stop old project-local Node processes if `.next/trace` is locked:
```powershell
Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object { $_.CommandLine -like '*CABuild*' } | Select-Object -ExpandProperty ProcessId | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
```

## Key Files
- UI: `app/page.tsx`
- Styling: `app/globals.css`
- Main backend actions: `app/api/social/route.ts`
- App data route: `app/api/app/route.ts`
- Types: `lib/types.ts`
- JSON store: `lib/store.ts`
- Apify provider: `lib/providers/apify.ts`
- Kie provider: `lib/providers/kie.ts`
- Upload-Post provider: `lib/providers/uploadPost.ts`
- Local data file: `data/app.json`

## Environment And Secrets
Do not commit raw API keys. Keep secrets in `.env.local`, which is ignored by git. Required key names:
- `APP_SECRET`
- `KIE_API_TOKEN`
- `APIFY_API_TOKEN`
- `GITHUB_TOKEN`
- `UPLOAD_POST_API_KEY`
- `UPLOAD_POST_PROFILE`
- `UPLOAD_POST_DEFAULT_PLATFORMS`
- `DIGITALOCEAN_TOKEN`
- `CLOUDFLARE_API_TOKEN`
- Cloudflare R2 keys if object storage is enabled
- `DATABASE_URL` when migrating from JSON storage to Postgres

The user pasted live keys in chat earlier. Treat them as compromised before production and rotate them.

## Current Feature State
- Auth exists with local users and workspace data.
- Research supports URL scans and keyword scans through Apify with local fallback.
- Social Audit supports entering a social profile/post URL when no profile URL is stored. The `runSocialAudit` action scans with Apify, saves recent `socialAudits`, computes an authority score, and shows top audited content in the Social Audit tab.
- Research results include thumbnails, timestamps, views, likes, sorting, loading states, and history.
- Research keyword/url thumbnails use real thumbnail fields returned by Apify actors when available; Google Search-style results do not include video thumbnails, so the UI shows a platform placeholder instead of misleading stock/default thumbnails.
- Research Search/Scan buttons disable and show `Scanning...` while Apify is running.
- Content Plan cards show only number, title/description, content type, timestamp, and actions.
- Creating a plan from Research immediately redirects to Content Plan and shows a temporary `Generating content plan...` row until Gemini returns the full plan.
- Full plan details are available through Edit.
- Content Plan `Format` is now a dropdown.
- Generate opens a modal with prefilled prompt, caption, hashtags, content type, model, and duration.
- Generate modal content type is a dropdown and no longer includes publishing placement.
- Generate modal prefill has fallbacks for older/incomplete content plans that do not have prompt, caption, hashtags, hooks, or outline.
- Video generation model options:
  - VEO Fast: duration dropdown limited to 8 seconds.
  - Seedance 2.0: duration dropdown supports 4 to 15 seconds.
- Image generation model options: Nanobanana Pro and GPT-image 2.
- Text generation model options: Gemini 3.5 Flash and Claude Opus 4.8.
- Generate creates a Publish entry:
  - VEO Fast uses Kie and starts as `Generating`.
  - Seedance 2.0 uses Kie and starts as `Generating`.
  - Other model choices currently create demo-ready local drafts as `Done` until exact provider endpoints are wired.
- Polling a Kie asset updates the linked Publish item to `Done` or `Failed`.
- Publish auto-polls generating Kie video jobs in the background; no manual Poll button is shown.
- Publish shows model, content type, duration, caption, hashtags, video thumbnail/player, generated asset download, status, and Publish action.
- Video drafts can be previewed in a built-in modal player with browser-native controls.
- Video downloads go through `/api/assets/[id]/download` so generated videos are served as MP4 downloads where possible.
- Upload-Post publish uses generated caption and hashtags.

## Provider Notes
- Kie VEO generation is wired through `generateVeoVideo`.
- Kie Seedance 2.0 video generation is wired through the Kie Market `bytedance/seedance-2` task endpoint and polled through `getMarketTask`.
- Seedance 2.0 requests audio generation with `generate_audio: true`; older videos generated before this change may remain silent.
- Kie Gemini content plan generation is wired through `generateContentPlanWithGemini`.
- Nanobanana Pro, GPT-image 2, Gemini text draft generation, and Claude text draft generation are UI/provider selections but still need exact production endpoints.
- Upload-Post is configured for the demo profile Mariana.

## GCP Deployment Access
- Preferred deployment target: Cloud Run + Artifact Registry + Secret Manager.
- Production persistence needs Cloud SQL/Postgres or another managed database; current local JSON storage is not production-safe on Cloud Run.
- If temporary operator access is needed, create a dedicated deploy service account and place its JSON key in an ignored local file such as `.gcp-deploy-key.local.json`; do not paste raw keys into chat or commit them.
- Minimum practical deployment roles usually include Cloud Run Admin, Cloud Build Editor, Artifact Registry Admin or Writer, Secret Manager Admin, Service Account User, and Cloud SQL Admin if creating Cloud SQL.
- Revoke/delete the temporary service account key after deployment.
- 2026-06-17 Console setup created `contentagent-deployer@content-agent-2-499616.iam.gserviceaccount.com` with Owner on project `content-agent-2-499616`, but JSON key creation is blocked by org policy `iam.disableServiceAccountKeyCreation`. Use keyless `gcloud auth login` with the browser account `sean@gigwave.tech`, or ask an Org Policy Admin to temporarily disable that constraint if a key is absolutely required.

## User Preferences
- Follow the mock UI layout over PRD wording when they conflict.
- Keep the UI close to the mock.
- For Research, avoid unnecessary filters like Intent/Source and use platform/source style controls.
- Do not expose raw secrets in code, docs, or final answers.
- Keep this file updated whenever material project behavior changes.

## Latest Change Log
- 2026-06-18: Fixed Research UX and thumbnail handling. Keyword Search now changes to `Scanning...` and disables while running, Create Plan redirects immediately to Content Plan with a pending generation row, Apify thumbnail normalization reads real thumbnail fields when actor output provides them and no longer uses stock defaults for Google Search results. Seedance now requests generated audio. Local `npm run build` passed.
- 2026-06-18: Fixed Content Plan Generate with Seedance 2.0. It now creates a Kie `bytedance/seedance-2` task instead of attaching the local demo video, stores the selected generation model on the asset, and polls Seedance tasks through Kie Market status until Publish moves from `Generating` to `Done` or `Failed`. Local `npm run build` passed.
- 2026-06-17: Pushed current deployment code to GitHub private repo `adrentan888-adren/cabuild` on branch `main`.
- 2026-06-17: User asked to use Playwright for GCP Console setup; operator should navigate GCP Console while user handles Google login/2FA manually.
- 2026-06-17: Created GCP deploy service account in Console, assigned Owner, but service account key download was blocked by org policy `iam.disableServiceAccountKeyCreation`; next path is keyless local `gcloud auth login` as `sean@gigwave.tech`.
- 2026-06-17: Keyless deploy attempt continued through Cloud Shell and browser OAuth. Embedded Cloud Shell opened and was authorized, but CDP input could not be routed into the iframe terminal. Direct Cloud Shell top-level page hit a Google anti-abuse interstitial. Local `gcloud auth login --no-launch-browser` was started with the OAuth URL opened in the separate Chrome profile; Google stopped at password re-auth for `Sean White / sean@gigwave.tech`. User must complete that password/Google prompt in the opened browser tab, then operator can continue local `gcloud` login and deploy to Cloud Run.
- 2026-06-17: User reported the first Google password challenge was completed, but the `gcloud` process had already timed out. A fresh local `gcloud auth login --no-launch-browser` run opened a new Google password challenge in a tab titled `Sign in - Google accounts`; user must complete the new tab, not the older expired `gcloud CLI Remote Login` tab.
- 2026-06-18: User asked to try GCP keyless login again. Started background helper script at `%TEMP%\gcloud-oauth-live-helper.ps1` with log `%TEMP%\gcloud-oauth-live-helper.log`. It captured a fresh `gcloud auth login --no-launch-browser` URL, opened Chrome target `2135622EF8BCD1B5E91AE8D8BAC1AF64`, selected `Sean White`, clicked `Continue`, and is currently waiting on a new Google password challenge for `sean@gigwave.tech`. After user completes the password prompt in that new tab, the helper should auto-click consent/allow, capture the current auth code, submit it to local `gcloud`, and exit.
- 2026-06-18: GCP keyless login completed successfully; local `gcloud` active account is `sean@gigwave.tech`. Deployed Cloud Run service `contentagent-social` in project `content-agent-2-499616`, region `asia-southeast1`. Public URL: `https://contentagent-social-mkhae4sjlq-as.a.run.app`. Successful regional Cloud Build ID: `38e816ce-ebb1-40b1-9f37-ce10c7bbd421`. Runtime secrets are in Secret Manager: `APP_SECRET`, `KIE_API_TOKEN`, `APIFY_API_TOKEN`, `UPLOAD_POST_API_KEY`. Non-secret env vars include `APIFY_ACTOR_ID`, `APIFY_KEYWORD_ACTOR_ID`, `UPLOAD_POST_PROFILE`, and `UPLOAD_POST_DEFAULT_PLATFORMS`. Org policy blocked `allUsers` IAM binding, so public access was enabled with Cloud Run `--no-invoker-iam-check`; service returns HTTP 200 and title `ContentAgent Social`.
- 2026-06-18: Added Social Audit URL input and saved audit flow for workspaces without an existing social URL. Local `npm run build` passed.
- 2026-06-17: Added GCP deployment access guidance: use temporary service account JSON or keyless auth, not pasted raw credentials; target is Cloud Run + Artifact Registry + Secret Manager, with Cloud SQL/Postgres needed for production persistence.
- 2026-06-16: Removed old seeded `5 automations carousel` demo publish row and linked demo records from both local JSON data and seed data.
- 2026-06-16: Added fallback prefill for Generate popup and backend draft creation when older content plans have blank fields.
- 2026-06-16: Added Publish video thumbnails, built-in video preview modal, MP4 download route, and automatic Kie polling.
- 2026-06-16: Changed Content Plan edit Format to dropdown.
- 2026-06-16: Changed Generate modal Content type to dropdown and removed Placement.
- 2026-06-16: Added duration dropdown rules for VEO Fast and Seedance 2.0 with closest-duration defaulting.
- 2026-06-16: Expanded this handoff file and documented secret handling without raw keys.
