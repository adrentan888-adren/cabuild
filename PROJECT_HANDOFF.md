# CABuild Project Handoff

Last updated: 2026-06-22

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
- CI/CD path: repo now includes `Dockerfile`, `.dockerignore`, and `cloudbuild.yaml` so GCP can deploy from GitHub via a Cloud Build trigger. Once that trigger is connected, future deploys should only require `git push` to `main`.
- GitHub Actions path is configured in `.github/workflows/deploy-cloud-run.yml` with GCP Workload Identity Federation. This is the preferred path now because it does not require Cloud Build's GitHub app connection or service account keys.

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
- Social Audit is connected-account-only. It reads connected social accounts from the Upload-Post profile, shows a `Connect social media` button that opens the same Upload-Post connection page as Settings, and auto-runs `auditConnectedSocials` when connected accounts do not have audits yet.
- `auditConnectedSocials` scans every connected Upload-Post account URL with Apify, stores one `socialAudit` per connected account, and the Social Audit tab shows only those connected-account results.
- Social Audit follows the mock dashboard layout more closely: authority hero, reach/engagement/posts/follower signal metrics, engagement trend, connected-account breakdown, content pillar ratings, top posts, AI diagnostic, and visible `Analysing...` progress while Apify runs.
- Research results include thumbnails, timestamps, views, likes, sorting, loading states, and history.
- Research keyword/url thumbnails use real thumbnail fields returned by Apify actors when available; Google Search-style results do not include video thumbnails, so the UI shows a platform placeholder instead of misleading stock/default thumbnails.
- Research keyword scans using Google Search scraper submit selected platforms as separate search queries in one Apify run instead of one restrictive OR query; this reduces cases where Google returns only one organic result for a broad keyword.
- Research keyword search now allows one source/platform per search. The backend first tries a platform-specific Apify actor, then falls back to Google Search only if that actor is missing or fails.
- Platform actor env vars: `APIFY_TIKTOK_ACTOR_ID`, `APIFY_INSTAGRAM_ACTOR_ID`, `APIFY_YOUTUBE_ACTOR_ID`, `APIFY_FACEBOOK_ACTOR_ID`, `APIFY_LINKEDIN_ACTOR_ID`.
- Research Search/Scan buttons disable and show `Scanning...` while Apify is running.
- Research loading state keeps the search form layout stable while disabling controls and showing progress.
- Research results are visibly numbered. `Create plan` sends the selected result id, title, URL, and platform; the backend rejects the request if the id no longer matches the clicked title/URL, preventing stale or wrong-result plan creation.
- Content Plan cards show only number, title/description, content type, timestamp, and actions.
- Content Plan has a `New` button in the header. It opens a modal using the same editable fields as existing plan Edit, and saves through the `createBrief` backend action.
- Creating a plan from Research immediately redirects to Content Plan and shows a temporary `Generating content plan...` row until Gemini returns the full plan.
- Full plan details are available through Edit.
- Content Plan `Format` is now a dropdown.
- Generate opens a modal with prefilled prompt, caption, hashtags, content type, model, and duration.
- Generate modal content type is a dropdown and no longer includes publishing placement.
- Generate modal prefill has fallbacks for older/incomplete content plans that do not have prompt, caption, hashtags, hooks, or outline.
- Create Content follows the mock stacked-card layout with input source, content type/platform cards, model cards, optional assets, generation settings, prompt, caption, hashtags, and footer actions.
- Create Content no longer shows generated assets locally. Direct generation queues the item in Publish and redirects to the Publish tab, matching the Content Plan Generate flow.
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
- Preferred ongoing deploy path: Cloud Build trigger connected to GitHub `adrentan888-adren/cabuild`, branch `main`, using `cloudbuild.yaml`. This avoids manual `gcloud run deploy` after each code push.
- Active keyless GitHub deploy path: Workload Identity pool `github-contentagent`, provider `github-cabuild`, service account `github-cloud-run-deployer@content-agent-2-499616.iam.gserviceaccount.com`. GitHub Actions deploys on push to `main`.
- Production persistence needs Cloud SQL/Postgres or another managed database; current local JSON storage is not production-safe on Cloud Run.
- If temporary operator access is needed, create a dedicated deploy service account and place its JSON key in an ignored local file such as `.gcp-deploy-key.local.json`; do not paste raw keys into chat or commit them.
- Minimum practical deployment roles usually include Cloud Run Admin, Cloud Build Editor, Artifact Registry Admin or Writer, Secret Manager Admin, Service Account User, and Cloud SQL Admin if creating Cloud SQL.
- Revoke/delete the temporary service account key after deployment.
- 2026-06-17 Console setup created `contentagent-deployer@content-agent-2-499616.iam.gserviceaccount.com` with Owner on project `content-agent-2-499616`, but JSON key creation is blocked by org policy `iam.disableServiceAccountKeyCreation`. Use keyless `gcloud auth login` with the browser account `sean@gigwave.tech`, or ask an Org Policy Admin to temporarily disable that constraint if a key is absolutely required.

## User Preferences
- Follow the mock UI layout over PRD wording when they conflict.
- Keep the UI close to the mock.
- For Research, avoid unnecessary filters like Intent/Source and use platform/source style controls.
- Preserve generated asset, Publish, Content Plan, Research, and Social Audit history across app upgrades. Do not remove history during upgrades unless it directly conflicts with the requested migration and the user explicitly approves the removal.
- Do not expose raw secrets in code, docs, or final answers.
- Keep this file updated whenever material project behavior changes.

## Latest Change Log
- 2026-06-23: Changed Create Content image defaults from `nanobanana-pro` to `gpt-image-2`. The shared frontend model list now selects GPT-image 2 first for image type, and backend fallback defaults for both `generateDraftFromPlan` and `generateDirectContent` use `gpt-image-2` when no image model is supplied. Local `npm run build` passed.
- 2026-06-22: Audited and improved the Persona module. Fixed unchecked Persona toggles so they can persist `false`, added autosave before step-dot/back/continue navigation to prevent losing unsaved step edits, moved autofill URLs into the explicit Auto-fill panel, added labeled step pills, and added a compact profile completion/tone/topic summary strip. No generation prompts consume persona data yet. Local `npm run build` passed.
- 2026-06-22: Made the bottom sidebar user pill (`Sean Tan`) clickable. It now opens a drop-up account menu with quick links to `Persona` and `Settings`, closing after navigation. Local `npm run build` passed.
- 2026-06-22: Rebuilt the Persona tab to follow the mock UI structure. Added a standalone persisted `PersonaProfile` data model keyed by workspace with Identity, Audience, Voice, Rules, References, source URLs, tone sliders, vocabulary/topic lists, writing samples, face/voice reference filenames, and consent toggles. Added `updatePersonaProfile` backend action and `/api/app` now returns `personaProfile`. The Persona tab stores data for future prompts but no generation prompts consume it yet. Local `npm run build` passed.
- 2026-06-22: Live-tested Create Content `Generate with AI` for Video, Image, and Text requested formats. Fixed the API draft cleanup so `duration` is returned only for video formats; image/text drafts now return blank duration even if GPT-5.5 includes a number. Local `npm run build` passed.
- 2026-06-22: Made Create Content `Generate with AI` respect the currently selected content type. The frontend now sends a requested format (`Short video 9:16`, `Image 4:5`, `Text post`, etc.) based on the selected Video/Image/Text state, and the Kie GPT-5.5 prompt explicitly requires matching fields: video prompts for video, image-composition prompts for image, and text-post fields for text. Backend validation forces the returned draft format to the requested format and logs it. Local `npm run build` passed.
- 2026-06-22: Added `Generate with AI` to the Create Content tab using the same GPT-5.5 Kie action as New Content Plan. The button sits in the Input source card beside `Use a content plan instead`, opens the same “Tell me in a sentence or few...” prompt, animates `Generating...`, and remounts the shared Create Content module with AI-prefilled content type, platform, prompt, caption, hashtags, duration, and aspect ratio. Local `npm run build` passed.
- 2026-06-22: Added animated loading dots for generation states. A reusable `AnimatedDots` component cycles visible dots from one to three on `Generating`, `Preparing generation`, `Starting provider`, `Auto-checking`, generated video/image pending thumbnails, and the GPT-5.5 New plan button. CSS reserves fixed dot width so buttons/chips do not shift while animating. Local `npm run build` passed.
- 2026-06-22: Fixed workspace niche clearing and removed hidden AI automation fallbacks from generated content prompts. `updateWorkspace` now allows Brand/niche to be saved as blank instead of keeping the previous value. GPT-5.5 New Content Plan generation no longer falls back to `SME AI automation`; blank niche now becomes explicit “No brand/niche set. Follow the user request exactly and do not assume a niche.” Research create-plan prompts/fallbacks and direct Create Content defaults now use the saved workspace niche or generic brand wording instead of hardcoded AI automation. Local `npm run build` passed.
- 2026-06-22: Added editable workspace context in Settings. Users can now change Workspace name and Brand/niche after registration; this `workspace.niche` value is what appears in the top bar and is passed into GPT-5.5 AI content-plan generation as `Brand/niche`. Backend action `updateWorkspace` persists the change to the same durable store and logs activity. Local `npm run build` passed.
- 2026-06-22: Added AI-assisted New Content Plan creation. In Content Plan, clicking `New` now shows `Generate with AI` beside `Close`; clicking it opens an inline prompt box saying “Tell me in a sentence or few, then I can create anything for you.” The prompt box has its own `Generate` button with immediate `Generating...` state. Backend action `generateBriefWithAi` calls Kie GPT-5.5 via `/codex/v1/responses` with `model: gpt-5-5`, logs the full prompt/result in Debug Logs, and returns a draft that populates all New content plan fields without saving until the user clicks `Create plan`. Local `npm run build` passed.
- 2026-06-22: Updated Content Plan `New`/edit format options to use image dimension names only: `Image 1:1`, `Image 4:5`, `Image 16:9`, and `Image 9:16`. Create Content labels now say `Image` instead of `Image / carousel`, while detection remains compatible with older carousel history. New image generations are stored as `image` assets rather than `carousel`. Local `npm run build` passed.
- 2026-06-22: Standardized all image generation dimension controls to aspect ratios only: `1:1`, `4:5`, `16:9`, and `9:16`. The shared Create Content module and Content Plan Generate popup now show `Image dimension` instead of pixel image sizes. Backend generation settings no longer include `imageSize`; Kie image generation accepts only normalized `aspectRatio` and defaults invalid values to `1:1`. Existing content-plan formats prefill image aspect ratio from `Image / carousel 1:1` or `4:5`. Local `npm run build` passed.
- 2026-06-22: Fixed Create Content Generate still feeling slow after the optimistic Publish row change. The shared `CreateContentModule` no longer uses React form `action={asyncFn}` for generation submission; it now uses a normal client `onSubmit` handler so UI updates are not batched until the async upload/provider work finishes. Parent `onStart` callbacks use `flushSync` to switch to Publish and show the pending row immediately before background upload/generation continues. Local `npm run build` passed.
- 2026-06-22: Fixed remaining Generate click delay when uploaded references are attached. `CreateContentModule` now calls an `onStart` callback immediately on submit before reference uploads begin. Content Plan Generate and Create Content set an optimistic `pendingGeneration` row and switch to Publish instantly; the pending row shows `Preparing generation` until the real Publish queue row arrives from `/api/social`, then it is automatically cleared. Local `npm run build` passed.
- 2026-06-22: Added a persistent Logs tab for debugging. `debugLogs` now stores action requests, uploaded reference asset metadata, full prompts sent to Gemini/Kie/Upload-Post, provider task IDs, payload summaries, and errors. `/api/app` returns the latest 200 logs, with UI filters by provider/status and expandable prompt/detail blocks. Also changed Generate from Content Plan/Create Content to redirect to Publish immediately after creating the Publish row; the Publish tab now starts missing Kie provider tasks in the background via `startAssetGeneration`, then continues automatic polling. Local `npm run build` passed.
- 2026-06-22: Implemented real uploaded reference handling for Create Content and Content Plan Generate. Product photo, Override avatar, and Logo uploads now POST to `/api/uploads`, are stored in the private GCS history bucket when available, and are exposed to Kie through unguessable `/api/public-uploads/[token]` proxy URLs built from forwarded Cloud Run host/proto headers. The shared Create Content module uploads selected files before generation, enriches prompts with the actual reference URLs, and sends `assetReferences` through Asset/Publish history. Kie image generation passes references to Nano Banana Pro via `image_input` and GPT Image 2 via `input_urls`/image-to-image; Seedance 2.0 receives `reference_image_urls`; Veo Fast uses `REFERENCE_2_VIDEO` with up to three `imageUrls`. Local `npm run build` passed.
- 2026-06-22: Executed `clearWorkspaceHistory` once on live Cloud Run at the user's request. Verified before: 2 content plans, 2 assets, 2 publish rows, 3 social audits, 2 research scans. Verified after: 0 content plans, 0 assets, 0 publish rows, 0 social audits, 0 research scans. Persistent GCS history remains active for all future generated outputs.
- 2026-06-22: Added guarded backend action `clearWorkspaceHistory` for one-time current-history clearing. It removes workspace Content Plans, Assets, Publish rows, Social Audits, Research Scans, non-seed Competitor Results, and Activity while leaving users/workspace/settings and the persistent GCS store in place for future history.
- 2026-06-22: Added durable generated-history persistence. `lib/store.ts` now supports `DATA_STORE_GCS_BUCKET`/`DATA_STORE_GCS_OBJECT` and reads/writes app history to a GCS JSON object on Cloud Run, with local JSON fallback if GCS is unavailable. GitHub Actions and Cloud Build configure bucket `contentagent-social-history-content-agent-2-499616`, seed it once from `data-seed/app.json`, and do not overwrite it after live history exists. After granting `Storage Admin` to `github-cloud-run-deployer@content-agent-2-499616.iam.gserviceaccount.com`, workflow run `27925424349` created the bucket, seeded `app.json`, and deployed successfully. Live `/api/app` verified restored history: 2 content plans, 2 assets, 2 publish rows, 3 social audits, and 2 research scans.
- 2026-06-22: Strengthened uploaded reference prompt handling for both image and video generation. Product photo, Override avatar, and Logo references are now inserted with explicit role-specific usage, placement, recognizability, and contrast/stroke/shadow instructions in the shared Create Content module. Added a backend fallback that enriches prompts from `assetReferences` if an older client submits references without the enriched prompt.
- 2026-06-22: Fixed image generation falsely showing as `Done` without an image. `nanobanana-pro` and `gpt-image-2` now create Kie Market image tasks via `/api/v1/jobs/createTask`, poll `/api/v1/jobs/recordInfo`, and only move Publish rows to `Done` when a result URL exists. Publish now displays image thumbnails. Existing image rows that were marked done without an asset URL are shown as failed with a regeneration note.
- 2026-06-22: Added image thumbnails for Product photo, Override avatar, and Logo uploads inside the shared Create Content generation module. Previews are browser-local object URLs only; generation payloads continue to send clean role/filename metadata.
- 2026-06-19: Unified the Content Plan `Generate` popup and the Create Content tab into one shared `CreateContentModule`. Added clickable Product photo, Override avatar, and Logo upload controls for video/image generation; selected reference filenames are included in the generation payload and the prompt is enriched with role-specific visual guidance plus high-conversion social media direction. Current Kie video integration still sends text prompts to Kie; selected files are used as prompt context/metadata, not binary uploads to the provider.
- 2026-06-18: Rebuilt Create Content tab to match the Content Plan Generate popup fields. Added direct generation backend action `generateDirectContent`, which creates the same Asset/Publish entries as content-plan generation and queues Kie video jobs for VEO Fast or Seedance 2.0. Local `npm run build` passed.
- 2026-06-18: Fixed Research keyword scan feedback so the Search button greys out immediately, label changes to `Scanning...`, and progress/loading rows appear as soon as the form is submitted. Replaced form action handling with explicit submit handlers plus immediate pending state. Local `npm run build` passed.
- 2026-06-18: Second GitHub Actions deployment built and pushed the Docker image successfully, but `gcloud run deploy` failed because comma-separated `UPLOAD_POST_DEFAULT_PLATFORMS` broke `--set-env-vars` parsing. Updated GitHub Actions and Cloud Build deploy recipes to write/use `cloudrun-env.yaml` via `--env-vars-file`.
- 2026-06-18: First GitHub Actions deployment ran and authenticated successfully, but Docker build failed because `data/*.json` is gitignored and the Dockerfile tried to copy `/app/data`. Fixed Dockerfile to create a writable `data` directory instead; app seed data is created at runtime when `data/app.json` is absent.
- 2026-06-18: Set up keyless GitHub Actions deployment to Cloud Run using GCP Workload Identity Federation. Created pool `github-contentagent`, provider `github-cabuild`, deployer service account `github-cloud-run-deployer@content-agent-2-499616.iam.gserviceaccount.com`, and granted deploy roles. Added `.github/workflows/deploy-cloud-run.yml` so future pushes to `main` build and deploy to Cloud Run from GitHub.
- 2026-06-18: Added GitHub-to-GCP CI/CD files: `Dockerfile`, `.dockerignore`, and `cloudbuild.yaml`. Next.js now builds with `output: "standalone"`. Cloud Build recipe builds an Artifact Registry image and deploys Cloud Run with existing Secret Manager secrets and non-secret env vars, then reapplies `--no-invoker-iam-check`. Local `npm run build` passed; local Docker is unavailable, so container build must be verified by Cloud Build. One-time GitHub Cloud Build trigger setup still needs GCP reauthentication.
- 2026-06-18: Changed Research keyword source selection from multi-select checkboxes to a single platform radio-style selector. Added platform-specific Apify actor routing with defaults for TikTok (`clockworks/tiktok-scraper`), Instagram (`apify/instagram-scraper`), YouTube (`streamers/youtube-scraper`), and Facebook search (`scrapeforge/facebook-search-posts`), with Google Search retained only as fallback. Added YouTube to the shared `Platform` type and updated `.env.example`. Local `npm run build` passed. Cloud Run deployment still needs `sean@gigwave.tech` Google reauthentication.
- 2026-06-18: Audited recent Apify keyword run `JsAL5ZezDmic0XIwW`: Apify succeeded but Google Search returned one organic result for an over-constrained `igcse tuition` OR query. Changed keyword query construction to send selected platform searches as separate queries with two pages each. Local `npm run build` passed.
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
### 2026-06-23 - Remove Video 1:1 and Publish E2E Audit Report
- Removed `1:1` from the video aspect ratio dropdown in the shared Create Content module.
- Added backend aspect-ratio normalization so stale video requests using `1:1` are coerced to `9:16`; image requests still support `1:1`, `4:5`, `16:9`, and `9:16`.
- Added a standalone static audit report at `/e2e-generation-audit.html` with the latest Playwright E2E generation results. The report excludes video `1:1` rows because video generation should not support that dimension.
### 2026-06-23 - Publish Image Preview Modal
- Changed Publish tab image thumbnails from direct external links to in-app preview buttons.
- Reused the media preview modal for image and video assets; image previews now show the generated image in a pop-up with a download button.
