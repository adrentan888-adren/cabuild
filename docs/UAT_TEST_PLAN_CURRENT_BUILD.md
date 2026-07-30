# ContentAgent Current-Build UAT Test Plan

## 1. Document Control

| Field | Value |
|---|---|
| Product | ContentAgent |
| Environment | Staging only |
| Branch | `staging/admin-split` |
| Static-audit commit | `6786fa4f10abebb31ba30bf25878b998f4166d69` |
| Execution baseline | Record the deployed commit and Cloud Run revisions immediately before execution |
| Plan revision | 2 - independent code-aligned UAT audit |
| Last revised | 2026-07-30 MYT |
| Time zone | Asia/Kuala_Lumpur (MYT) |
| Plan owner | Developer agent |
| Executor | Independent UAT agent or assigned human tester |
| Production changes | Prohibited during UAT |

This plan covers the complete current staging application: frontend, admin backend, API, authentication, integrations, billing, automation, generated-media history, Product Video Studio, and post-production caption handling.

### Baseline and Revision Rules

1. The static-audit commit identifies the code reviewed when this plan was written; it is not automatically the execution baseline.
2. Before each UAT run, record the frontend, admin, and API Cloud Run revision plus the Git commit deployed to each surface. Stop if the three surfaces are not from the intended compatible release.
3. If application code, infrastructure, provider configuration, prompt templates, rate cards, or database schema changes after execution starts, record the change and identify all affected test IDs.
4. Test results may be carried forward only when the UAT lead documents why the changed files and configuration cannot affect that test. P0 financial, authorization, isolation, generation, and publishing results must be rerun on the new baseline.
5. The developer agent updates implementation and deployment notes. The independent UAT agent owns test evidence, defects, retest results, and this plan's code-coverage audit.
6. New test IDs are never reused or renumbered after a result has been recorded.

## 2. Objectives

1. Confirm all user-visible workflows work end to end on staging.
2. Confirm roles, permissions, user isolation, and admin controls behave correctly.
3. Confirm paid provider calls reserve, settle, release, or refund credits correctly.
4. Confirm generated content, research history, persona data, billing history, and uploaded media survive deployments.
5. Confirm failures are visible, recoverable, logged, and do not silently consume credits.
6. Confirm no test changes production services or production data.

## 3. Test Classification

| Label | Meaning | Approval |
|---|---|---|
| FREE | UI, validation, navigation, local calculations, mocked/test-mode operations | UAT agent may run |
| PAID-APIFY | Runs an Apify actor | Obtain paid-test approval |
| PAID-KIE | Runs Kie text, image, or video generation | Obtain paid-test approval |
| PAID | Runs one or more paid providers identified in the test preconditions | Obtain approval for every named provider and set a maximum budget |
| PUBLISH | Posts through Upload-Post | Obtain publishing approval and use test accounts |
| EMAIL | Sends a Brevo verification email | Use an approved test mailbox |
| STRIPE-TEST | Stripe test-mode payment | UAT agent may run with Stripe test cards |
| LIVE-MONEY | Real Stripe payment/refund | Explicit approval required for each transaction |
| DESTRUCTIVE | Deletes users, history, configuration, or billing data | Backup and explicit approval required |

## 4. Priorities and Result Codes

- **P0**: Authentication, authorization, financial integrity, data loss, cross-user access, production impact, or paid action charged incorrectly.
- **P1**: Core user journey, provider generation, publishing, history, failure recovery, and admin management.
- **P2**: Secondary usability, presentation, responsiveness, filtering, sorting, and uncommon edge cases.
- Results: `Not run`, `Pass`, `Fail`, `Blocked`, `Not applicable`, `Accepted risk`.

Promotion is blocked by any unresolved P0, any unexplained paid-provider charge, or any cross-user data leak.

## 5. Staging Endpoints

Record the canonical URLs at execution time:

| Surface | URL | Health/result |
|---|---|---|
| Frontend | `https://contentagent-social-staging-mkhae4sjlq-as.a.run.app/` | |
| Admin | `https://contentagent-admin-staging-mkhae4sjlq-as.a.run.app/admin` | |
| API | `https://contentagent-api-staging-mkhae4sjlq-as.a.run.app` | |
| GitHub deployment | Record Actions run URL | |

## 6. Required Test Identities

- Super admin with all permissions.
- Restricted admin who can view users but cannot edit or delete.
- Standard verified user with sufficient credits.
- Standard verified user with zero credits.
- New unverified user.
- Disabled user.
- Two standard users for isolation testing.
- Upload-Post test profile with non-production social accounts.
- Stripe test customer.

Never record passwords, raw API keys, card details, session cookies, authorization headers, or verification codes in evidence.

## 7. Required Test Data

- Valid and invalid email addresses and passwords.
- LinkedIn and Facebook persona URLs.
- Instagram profile URL for strict URL research.
- Keywords expected to return Instagram, TikTok, YouTube, Facebook, and LinkedIn results.
- Square, portrait, landscape, extremely wide, extremely tall, undersized, and oversized image files.
- Logo containing readable text.
- Avatar/person image and at least two product images.
- Audio shorter than 14 seconds and audio longer than 14 seconds.
- Corrupt audio, silent audio, and a browser-recorded WebM/M4A sample.
- Microphone access allowed and denied scenarios.
- Image boundary samples at 299px, 300px, 6000px, and 6001px, plus aspect ratios immediately below/at/above 0.40 and 2.50.
- Video prompts for 9:16 and 16:9.
- Image prompts for 1:1, 4:5, 16:9, and 9:16.
- Text-post prompt.
- Caption containing punctuation, Malay/English text, and line wrapping.
- Empty caption, caption containing emoji/non-Latin text, and caption materially different from the spoken audio.
- Product Video Studio inputs for 8s, 20s, and 30s storyboards, including one edited scene prompt and one intentionally failing scene.

## 8. Evidence Standard

Every P0/P1 result must include:

- Test ID, tester, MYT timestamp, deployed commit, and environment.
- Before/after screenshots or screen recording.
- Sanitized request status and relevant response fields.
- Provider task/run ID for paid actions.
- Credit balance before and after, quote, reservation, settlement/refund ledger IDs.
- Matching activity/debug log entry.
- Output URL for generated media.
- Defect ID and reproduction steps for failures.

## 9. Execution Waves

### Wave A: Deployment and Free Smoke

Run all FREE P0/P1 tests. Stop if login, API connectivity, navigation, data loading, or permissions fail.

### Wave B: Controlled Provider Tests

After Wave A passes, approve a fixed credit budget and run Apify and Kie tests one at a time. Record provider and billing evidence after every action.

### Wave C: External Integrations

Run Brevo, Stripe test mode, Upload-Post test publishing, and scheduled automation. Do not use live payment or public social accounts without separate approval.

### Wave D: Regression and Resilience

Run concurrent-user, reload, tab-switch, deployment-persistence, provider-failure, responsive-layout, and accessibility checks.

## 10. Detailed UAT Checklist

### A. Deployment and Application Shell

| ID | Pri | Cost | Test | Expected result |
|---|---|---|---|---|
| DEP-01 | P0 | FREE | Record frontend/admin/API revision and deployment run | All staging surfaces reference the intended commit |
| DEP-02 | P0 | FREE | Open frontend, admin, and API health routes | No 5xx; correct surface and redirects |
| DEP-03 | P1 | FREE | Navigate every frontend module | Correct module loads without blank state or console error |
| DEP-04 | P1 | FREE | Refresh each route and use browser back/forward | Session and selected module remain coherent |
| DEP-05 | P1 | FREE | Test desktop, tablet, and mobile widths | No overlap, clipped controls, horizontal breakage, or unreadable text |
| DEP-06 | P0 | FREE | Compare staging and production service names, URLs, secrets, databases, buckets, and scheduled jobs | UAT traffic and writes are isolated to staging; no production resource is selected |
| DEP-07 | P0 | FREE | Compare frontend, admin, and API build/revision metadata | All surfaces use the intended compatible release; mixed revisions block UAT |

### B. Authentication and Registration

| ID | Pri | Cost | Test | Expected result |
|---|---|---|---|---|
| AUTH-01 | P0 | FREE | Sign in with valid account | Correct user workspace opens |
| AUTH-02 | P0 | FREE | Invalid password and unknown email | Generic error; no account enumeration |
| AUTH-03 | P0 | EMAIL | Register with email/password/confirmation | Verification code sent; account remains unverified |
| AUTH-04 | P0 | EMAIL | Leave registration incomplete, then request another code | Existing pending account can resend and complete verification |
| AUTH-05 | P0 | FREE | Reuse verified email | Duplicate account blocked clearly |
| AUTH-06 | P0 | FREE | Attempt login as disabled/unverified user | Access blocked correctly |
| AUTH-07 | P0 | FREE | Sign out and revisit protected URL | Redirected to login; session cannot be reused |
| AUTH-08 | P1 | EMAIL | Enter wrong/expired verification code, resend, then try the old and new codes | Wrong/expired and superseded codes fail without verifying; newest valid code verifies once |
| AUTH-09 | P0 | FREE | Authenticate in two browsers, reset password or disable the account, then reuse existing sessions | Revoked/disabled credentials cannot continue privileged or paid actions according to session policy |
| AUTH-10 | P1 | FREE | Submit registration and login with leading/trailing spaces and mixed-case email | Email is normalized consistently and does not create duplicate identities |

### C. Home

| ID | Pri | Cost | Test | Expected result |
|---|---|---|---|---|
| HOME-01 | P1 | FREE | Validate every metric against source records | Values are real and reconcile with Research, My Contents, Automation, and Billing |
| HOME-02 | P1 | FREE | Use Create Content action | Opens the reviewable Create Content workflow, not immediate paid generation |
| HOME-03 | P2 | FREE | Empty/new account | Meaningful zero states; no fake metrics |
| HOME-04 | P1 | FREE | Use each pipeline card/action with records in every status | Navigation opens the matching filtered module and counts do not double-count the same asset/publish row |

### D. Social Audit

| ID | Pri | Cost | Test | Expected result |
|---|---|---|---|---|
| AUD-01 | P1 | FREE | Connect social media | Upload-Post connection page opens directly |
| AUD-02 | P1 | PAID-APIFY | Audit connected accounts | Progress shown immediately; user may leave and return |
| AUD-03 | P1 | PAID-APIFY | Validate metrics and account breakdown | Results correspond to connected handles and mock-UI fields |
| AUD-04 | P1 | FREE | Provider failure/zero quota | Clear failure, no fake result, correct credit release |
| AUD-05 | P1 | FREE | Reload after completed audit | Audit history persists |
| AUD-06 | P1 | PAID-APIFY | Audit several connected platforms where one account fails or requires reauthentication | Successful accounts remain visible, failed account is identified, aggregate metrics exclude failed/stale data, and billing reflects actual completed work |

### E. Persona and Media Library

| ID | Pri | Cost | Test | Expected result |
|---|---|---|---|---|
| PER-01 | P1 | FREE | Edit and save persona fields | One profile is updated/replaced and persists in cloud |
| PER-02 | P1 | PAID-APIFY/PAID-KIE | Autofill from LinkedIn/Facebook URLs | Crawled data is transformed into correct persona fields |
| PER-03 | P1 | FREE | Upload logo, avatar, products, and audio | Thumbnails/audio indicators appear; products allow multiple |
| PER-04 | P1 | FREE | Record voice with microphone allowed | Recording timer works, stops at 14s, uploads and plays |
| PER-05 | P1 | FREE | Deny microphone permission | Clear recovery message; upload remains available |
| PER-06 | P1 | FREE | Upload audio over 14s | Stored generation reference is trimmed to first 14s |
| PER-07 | P0 | FREE | Sign in as another user | Persona and media are isolated |
| PER-08 | P1 | FREE | Deploy/reload after save | Persona assets and fields remain available |
| PER-09 | P1 | FREE | Stop recording manually before 14s and record again | First recording stops cleanly; the newly accepted recording replaces the single default audio without duplicate active references |
| PER-10 | P1 | FREE | Navigate away or close the recorder while recording | Microphone track stops, browser recording indicator clears, and no partial file is silently saved |
| PER-11 | P1 | FREE | Use a browser without MediaRecorder support or with an unsupported codec | Clear fallback/error appears and normal audio upload remains usable |
| PER-12 | P1 | FREE | Save a recorded audio reference, reload, and inspect its playback/download metadata | Durable audio loads from cloud storage with a supported MIME type, non-zero duration, and no credential-bearing URL |

### F. Research

| ID | Pri | Cost | Test | Expected result |
|---|---|---|---|---|
| RES-01 | P1 | PAID-APIFY | Strict search by profile/page URL | Results come only from entered source; exact post URLs retained |
| RES-02 | P1 | PAID-APIFY | Keyword search per supported platform | Relevant results appear with real thumbnail, media type, time, metrics, and source URL |
| RES-03 | P1 | FREE | Content-type options by platform | Only valid choices appear; invalid combinations cannot be submitted |
| RES-04 | P1 | PAID-APIFY | Search multiword keyword and hashtag normalization | Multiword query returns relevant results without silently changing intent |
| RES-05 | P1 | FREE | Start search, leave module, return | Persistent progress says user can return later |
| RES-06 | P1 | FREE | Click Search repeatedly | Button disables and one provider run is created |
| RES-07 | P1 | FREE | Sort by views/likes/date twice | Dropdown sort works and second same selection toggles direction |
| RES-08 | P1 | FREE | Open result preview | Exact media opens inside app; original source remains separately accessible |
| RES-09 | P1 | FREE | Reopen prior search from history | Cached result loads without a new paid scrape |
| RES-10 | P1 | PAID-KIE | Generate Content from selected result | Selected result metadata and media, not another row, populate Create Content |
| RES-11 | P1 | FREE | Complete a valid zero-result search and simulate a provider failure | Zero results and failure are distinct states; history, billing, and retry guidance are correct for each |
| RES-12 | P1 | FREE | Start one search, switch platform/query, then let the first result complete | Results remain attached to their original query/run and never overwrite or mix with the newer form state |
| RES-13 | P1 | FREE | Open multiple result cards and launch Generate Content from a non-first result | Preview and generation preserve that exact result ID, media URL/type, source URL, title, metrics, and duration |

### G. Create Content

| ID | Pri | Cost | Test | Expected result |
|---|---|---|---|---|
| CRT-01 | P1 | FREE | Switch video/image/text | Fields, models, dimensions, duration, references, and platforms update correctly |
| CRT-02 | P1 | FREE | Video model list | Only Seedance 2.0 Mini and Seedance 2.0 appear; no Veo |
| CRT-03 | P1 | FREE | Generate with AI for all three types | Only editable fields are populated; no final asset starts |
| CRT-04 | P1 | FREE | Select Persona assets and upload overrides | Correct assets are shown and included once |
| CRT-05 | P1 | FREE | Record voice in video module | Recording can replace uploaded audio and is previewable |
| CRT-06 | P1 | FREE | Upload extreme-ratio and invalid-size images | Image is proportionally scaled and padded, never stretched or cropped |
| CRT-07 | P1 | FREE | Inspect final video prompt in logs/debug | Global no-text/no-number guardrail and exact reference roles are present |
| CRT-08 | P1 | FREE | Click Generate | Immediate redirect to My Contents; generating row appears without 5-10s freeze |
| CRT-09 | P0 | FREE | Insufficient credits | Paid action blocked before provider call |
| CRT-10 | P0 | FREE | Double-click Generate | One asset, one reservation, one provider task |
| CRT-11 | P1 | PAID-KIE | Generate text with each supported text model | Final text, caption, hashtags, logs, and billing are correct |
| CRT-12 | P1 | PAID-KIE | Generate each image dimension/model | Playable/viewable output, references, logo handling, billing, and history pass |
| CRT-13 | P1 | PAID-KIE | Generate each video ratio/model/duration boundary | Provider accepts request; output dimensions and duration are correct |
| CRT-14 | P1 | FREE | Change video model after selecting duration and dimension | Duration is rounded/reselected to a value supported by the new model, dimension remains valid, and no stale invalid value is submitted |
| CRT-15 | P0 | FREE | Change model, duration, or output count while viewing the quote | Visible integer credit quote refreshes before Generate; queued reservation uses the final displayed configuration |
| CRT-16 | P1 | FREE | Select Persona logo/avatar/product/audio and then upload an override for the same role | UI clearly identifies precedence and provider payload contains only the intended active reference for single-value roles |
| CRT-17 | P1 | FREE | Record audio, replace it with an upload, then replace it with a Persona audio selection | Preview/label and submitted reference always match the last explicit selection; superseded files are not sent |
| CRT-18 | P0 | FREE | Cause reference upload/normalization to fail and click Generate | No asset, billing reservation, or provider task is created; actionable error identifies the failed reference |

### H. Video Prompt and Caption Post-Production

| ID | Pri | Cost | Test | Expected result |
|---|---|---|---|---|
| VID-01 | P1 | FREE | Review backend Global Video Generation Rules | Rule forbids generated words, numbers, URLs, labels, subtitles, and signs except uploaded logo |
| VID-02 | P1 | FREE | Edit rule and create a queued video | Latest saved rule is appended once, after user/AI prompt content, in the exact final provider prompt |
| VID-03 | P1 | PAID-KIE | Generate video with caption | Seedance raw output completes first; FFmpeg then creates a distinct captioned final MP4 before status becomes Done |
| VID-04 | P1 | PAID-KIE | Open My Contents preview | Final captioned video plays by default |
| VID-05 | P1 | PAID-KIE | Download final MP4 | Downloaded file is playable MP4 with captions |
| VID-06 | P1 | PAID-KIE | Download raw MP4 | File is original provider video without burned captions |
| VID-07 | P1 | PAID-KIE | Download `.srt` | Valid numbered cues, timestamps, UTF-8 text, and correct duration |
| VID-08 | P1 | PAID-KIE | Caption with Malay, punctuation, and long wrapping | Readable, safe-area caption; no clipping or encoding corruption |
| VID-09 | P1 | PAID-KIE | Video with empty caption | Final remains playable and equals the durable raw video; raw download works; empty/unavailable subtitle state is explicit and not presented as captioned |
| VID-10 | P0 | FREE | Simulate FFmpeg or final-storage failure | Raw output is retained, but the item is not represented as a successfully captioned final; error/fallback state is visible, logged, and credits follow the documented policy |
| VID-11 | P1 | FREE | Existing historical video | Remains playable; unavailable raw/SRT controls are hidden |
| VID-12 | P0 | FREE | Inspect final video prompts from direct Create, Research, Automation, and Product Video Studio | Every provider-bound prompt applies the current global no-text/no-number rule; only readable text already inside an uploaded user logo is exempt |
| VID-13 | P1 | PAID-KIE | Compare final MP4 with raw MP4 from the same generation | Visual/audio content, resolution, and duration match apart from caption overlay/re-encoding; raw has no burned caption and final does |
| VID-14 | P1 | PAID-KIE | Parse the downloaded SRT programmatically | UTF-8 file has sequential cue numbers, valid monotonic non-overlapping timestamps, no negative times, and final cue ends at or before actual video duration |
| VID-15 | P1 | PAID-KIE | Compare approved caption, SRT, burned text, and social publish description | Subtitle words match the approved caption source; hashtags/URLs are not burned unless explicitly approved, while publish metadata remains complete |
| VID-16 | P1 | FREE | Poll the same completed provider task repeatedly or from two tabs | Caption post-processing is idempotent: one final/raw/SRT set is retained, status does not regress, and duplicate storage objects/ledger events are not created |
| VID-17 | P1 | FREE | Inspect output while provider is done but FFmpeg is still processing | UI remains in a clear post-processing state and does not expose the raw provider video as the final captioned result |

### I. My Contents and Publishing

| ID | Pri | Cost | Test | Expected result |
|---|---|---|---|---|
| CON-01 | P1 | FREE | Generating item polling | Status progresses automatically without Poll button |
| CON-02 | P1 | FREE | Preview image/video/text | Opens in app instead of forced download |
| CON-03 | P1 | FREE | Reload and redeploy | All content history remains |
| CON-04 | P1 | PUBLISH | Publish each supported type to test accounts | Correct asset, caption, hashtags, and selected placement are posted |
| CON-05 | P1 | FREE | Publishing failure | Clear error, retry path, no duplicate post |
| CON-06 | P0 | FREE | Cross-user history access | Other user's assets and download URLs are inaccessible |
| CON-07 | P0 | PUBLISH | Publish a captioned video with final and raw URLs present | Upload-Post receives the durable final captioned MP4, never the raw or temporary provider URL |
| CON-08 | P1 | FREE | Inspect preview/download controls for image, text, legacy video, and new video | Only applicable controls appear; final/raw use MP4 MIME and filenames, captions use `.srt`, and links do not trigger regeneration |
| CON-09 | P0 | FREE | Attempt publish while generation/post-processing is queued, running, or failed | Publishing is blocked until a valid final asset is ready; no empty/raw/failed media is posted |
| CON-10 | P1 | DESTRUCTIVE | Delete one generated-history item with final/raw/SRT objects | Confirmation identifies impact; database rows and associated stored objects follow retention policy without affecting other history |

### J. Product Video Studio

| ID | Pri | Cost | Test | Expected result |
|---|---|---|---|---|
| PVS-01 | P1 | FREE | Open module and review required fields | Current CA layout is coherent and responsive |
| PVS-02 | P1 | FREE | Validate missing/corrupt/wrong-type/oversized product file, missing name, ratios, durations, and model choices | Invalid submissions are blocked before upload, AI planning, billing, or provider call |
| PVS-03 | P0 | PAID-KIE | Generate product video scenes | Each approved scene creates one owned provider task, visible progress and durable output; quotes, reservations, settlements, logs, and history reconcile |
| PVS-04 | P1 | FREE | Leave module, reload browser, and return during generation | Server-owned jobs continue; storyboard, task IDs, per-scene status, and completed outputs restore without relying on old page memory |
| PVS-05 | P1 | FREE | Simulate one failed scene and retry only that scene | Successful scenes remain; failed scene has actionable error; retry creates only one replacement task and no duplicate charge/history |
| PVS-06 | P0 | PAID-KIE | Click Build with GPT-5.5 | AI-planning credit cost is disclosed before call, one reservation/settlement is recorded, and helper text does not imply the planning call is free |
| PVS-07 | P1 | PAID-KIE | Build 8s, 20s, and 30s storyboards | Scene counts are 2/4/6 respectively; each duration is provider-supported and scene total matches the selected target without exceeding it |
| PVS-08 | P1 | FREE | Edit a middle scene after storyboard generation | Edited prompt remains attached to the correct scene and is the exact base sent on generation; untouched scenes do not change |
| PVS-09 | P1 | FREE | Inspect every scene prompt before provider submission | Product continuity instruction and current global video guardrail are present once; invented labels, captions, watermarks, words, and numbers are prohibited |
| PVS-10 | P1 | FREE | Use extreme-ratio, undersized, and oversized product images | Same proportional scale/pad normalization as Create Content is applied; preview and provider reference preserve complete product without stretch/crop |
| PVS-11 | P0 | FREE | Double-click Build and Generate, or trigger Generate from two tabs | At most one storyboard request and one task per approved scene/configuration are created; controls show deterministic busy state |
| PVS-12 | P1 | FREE | Return partial provider success where one scene has malformed/empty output URL | Successful scenes remain playable; invalid scene is failed, not marked success, and final status reports partial failure |
| PVS-13 | P1 | FREE | Reload after all scenes complete and inspect My Contents/history | Storyboard, prompts, task IDs, outputs, timestamps, and billing evidence remain durable and discoverable |
| PVS-14 | P0 | FREE | Query status using another user's or fabricated Kie task ID | API returns 403/404 without provider state or output URL; task ownership is enforced server-side |
| PVS-15 | P1 | FREE | Inspect product video planning/generation logs | Sanitized product inputs, model, scene number/duration, prepared reference URL, prompt, provider task ID, status, and billing IDs are traceable |

### K. Automation

| ID | Pri | Cost | Test | Expected result |
|---|---|---|---|---|
| AUT-01 | P1 | FREE | Create scheduled rule | Model, dimension, platform, schedule, assets, and caps validate |
| AUT-02 | P1 | FREE | Create source watcher with multiple URLs | URLs and Persona/upload references persist |
| AUT-03 | P1 | FREE | Invalid model/content combination | Backend normalizes or rejects it |
| AUT-04 | P1 | PAID-APIFY | Run source watcher | Best suitable non-duplicate source selected and logged |
| AUT-05 | P1 | PAID-KIE | Generate scheduled content | Uses same Create Content model/reference/guardrail/caption pipeline |
| AUT-06 | P1 | PUBLISH | Auto-publish to test account | Upload-Post receives final asset and correct metadata |
| AUT-07 | P0 | FREE | Low balance and per-run/monthly caps | Automation pauses/skips before provider call |
| AUT-08 | P1 | FREE | Duplicate detection | Recent source, topic, caption, and asset history prevent duplicate generation |
| AUT-09 | P1 | FREE | Pause/resume/delete | Schedule and history behave correctly |
| AUT-10 | P1 | PAID-KIE | Complete an automated video with caption | Automation stores final/raw/SRT through the same post-production pipeline; My Contents defaults to final and retains source/run linkage |
| AUT-11 | P0 | FREE | Invoke scheduler twice for the same due rule/time window | Lock/idempotency prevents duplicate research, generation, reservation, publish row, and social post |
| AUT-12 | P1 | FREE | Change Persona assets or global guardrail after a job is queued but before a later scheduled run | Each run records the configuration snapshot it actually uses; later runs use current approved configuration without mutating prior evidence |

### L. Billing and Credits

Use the separate `BILLING_PHASE_1_TO_12_TEST_CHECKLIST.md` for exhaustive billing validation. At minimum:

| ID | Pri | Cost | Test | Expected result |
|---|---|---|---|---|
| BIL-01 | P0 | FREE | Quote every paid action | Integer credits, visible before action, correct rate mapping |
| BIL-02 | P0 | PAID | Successful provider action | One reservation and one settlement; balance reconciles |
| BIL-03 | P0 | FREE | Provider rejects/fails | Reservation released/refunded according to policy |
| BIL-04 | P0 | FREE | Concurrent generations | Limits and balance cannot be overspent |
| BIL-05 | P1 | STRIPE-TEST | Buy each test package/plan | Checkout, webhook, credits, receipt/history, and idempotency pass |
| BIL-06 | P0 | STRIPE-TEST | Replay webhook | Credits are not granted twice |
| BIL-07 | P1 | FREE | Usage breakdown | Module/provider totals reconcile with ledger |
| BIL-08 | P1 | FREE | Mini/Seedance mappings | Active models map to correct editable rate cards; Veo is inactive |
| BIL-09 | P0 | PAID-KIE | Reconcile Product Video Studio planning and multi-scene generation | Every paid Kie call is quoted and charged through CA credits; no direct provider spend bypasses the user ledger |
| BIL-10 | P0 | FREE | Admin changes active model/rate-card cost, markup, or rounding rule | All affected button quotes and reservations update automatically; historical ledger entries remain unchanged |
| BIL-11 | P0 | FREE | Post-processing fails after provider generation succeeds | Provider cost settles exactly once; caption-processing policy is separately visible and does not refund or double-charge provider work incorrectly |

### M. Analytics, Logs, and Settings

| ID | Pri | Cost | Test | Expected result |
|---|---|---|---|---|
| OBS-01 | P1 | FREE | Compare analytics to source records | Counts and usage are real and reconcilable |
| OBS-02 | P1 | FREE | Inspect generation log | Sanitized prompt, model, duration, references, task ID, and result URL recorded |
| OBS-03 | P0 | FREE | Inspect logs for secrets | No raw API keys, passwords, tokens, cookies, or verification codes |
| OBS-04 | P1 | FREE | Save settings and reconnect integrations | Values persist and health status updates |
| OBS-05 | P1 | FREE | Trace one captioned video from queue through provider, storage, FFmpeg, and completion | Correlation IDs connect raw/final/SRT keys, task, asset, publish row, duration, and errors without exposing secrets |
| OBS-06 | P1 | FREE | Filter logs by Product Video Studio scene/task | Planning, each scene start/status/failure/retry, and billing event are individually attributable |

### N. Admin Backend

| ID | Pri | Cost | Test | Expected result |
|---|---|---|---|---|
| ADM-01 | P0 | FREE | Access admin as standard user | Denied |
| ADM-02 | P0 | FREE | User table sorting | Every column toggles correctly |
| ADM-03 | P0 | DESTRUCTIVE | Edit/reset/disable/delete test user | Permission checks and confirmation work |
| ADM-04 | P0 | FREE | Restricted admin actions | View allowed; edit/delete blocked |
| ADM-05 | P1 | FREE | Permission matrix | Detailed permissions persist and enforce API actions |
| ADM-06 | P0 | FREE | Change API key with invalid/valid test value | Input works; secret masked after save; health refreshes |
| ADM-07 | P1 | FREE | Edit prompt templates | Changes persist and affect later prompts |
| ADM-08 | P0 | FREE | Billing/Stripe permissions | Only authorized roles can change rates, packages, credentials, or launch state |
| ADM-09 | P1 | FREE | Finance reconciliation/export | Totals reconcile and sensitive data remains protected |
| ADM-10 | P0 | FREE | Clear or weaken Global Video Generation Rules and attempt save | Required safety rule cannot become blank or bypass mandatory no-text/no-number behavior without an explicit authorized policy change |
| ADM-11 | P1 | FREE | Save guardrail containing special characters and template-like text | Content persists exactly, renders safely, and is appended once to all new video paths without corrupting JSON/provider payload |
| ADM-12 | P0 | FREE | Leave API-key field blank, paste replacement, save, reload, and inspect responses/logs | Blank does not erase existing secret unintentionally; replacement is write-only/masked and never returned or logged |

### O. Security, Isolation, and Resilience

| ID | Pri | Cost | Test | Expected result |
|---|---|---|---|---|
| SEC-01 | P0 | FREE | Access another user's IDs through API | 403/404; no data disclosed |
| SEC-02 | P0 | FREE | Modify role/admin fields in request | Server ignores or denies |
| SEC-03 | P0 | FREE | Upload executable/wrong MIME/oversized file | Rejected safely |
| SEC-04 | P0 | FREE | XSS strings in persona, prompts, captions, filenames | Rendered as text; never executed |
| SEC-05 | P1 | FREE | Temporary provider URL expires | Stored final/raw/SRT remain available |
| SEC-06 | P1 | FREE | Refresh/close browser during long task | Server task continues and UI recovers |
| SEC-07 | P1 | FREE | Two users generate concurrently | Jobs, polling, credits, and outputs remain isolated |
| SEC-08 | P1 | FREE | Deploy a no-op staging revision | User data/history remains intact |
| SEC-09 | P0 | FREE | Tamper with final/raw/SRT public-upload tokens and storage keys | Invalid or altered token returns 404/403 without path traversal, object listing, or another workspace's media |
| SEC-10 | P0 | FREE | Submit fabricated provider task IDs to normal generation polling endpoints | Task must belong to the authenticated workspace/asset; provider status and output URLs are not disclosed cross-user |
| SEC-11 | P1 | FREE | Process a near-250MB generated video and concurrent caption jobs within staging limits | Size/time/resource limits fail predictably; temporary files are cleaned and the service remains responsive |

### P. Accessibility and Browser Compatibility

| ID | Pri | Cost | Test | Expected result |
|---|---|---|---|---|
| ACC-01 | P1 | FREE | Complete login, Persona recording, Create Content, video preview, and Product Video Studio using keyboard only | Logical focus order, visible focus, reachable controls, and no keyboard trap |
| ACC-02 | P1 | FREE | Open/close Generate, G01, preview, and admin edit modals | Focus moves into modal, remains contained, returns to trigger, and Escape/close behavior does not start a paid action |
| ACC-03 | P1 | FREE | Use recorder and generation progress with a screen reader | Record/stop state, elapsed time, errors, post-processing state, and completion are announced meaningfully |
| ACC-04 | P1 | FREE | Use final video player and download controls on desktop/mobile | Native playback controls are operable; buttons have distinct accessible names for final MP4, raw MP4, and SRT |
| ACC-05 | P2 | FREE | Check zoom at 200%, contrast, long filenames/prompts, and translated text | Content remains readable, controls do not overlap, and status is not conveyed by color alone |
| ACC-06 | P1 | FREE | Record and upload voice in supported Chrome/Edge/Safari variants | Supported browser codec is accepted or converted; unsupported environments show upload fallback without data loss |

## 11. UAT Agent Operating Rules

1. The UAT agent must not edit application code while executing this plan.
2. It may create evidence files and a test report under `docs/testing/uat-runs/<run-id>/`.
3. It must ask before any PAID, PUBLISH, LIVE-MONEY, or DESTRUCTIVE test.
4. It must state the maximum estimated credits or money before approval.
5. It must execute tests individually, not launch paid tests in parallel.
6. On a P0 failure, stop the affected wave and report immediately.
7. On a provider error, capture the sanitized response, task/run ID, credits, and logs before retrying.
8. It must never expose credentials in screenshots, logs, reports, or chat.
9. It must not deploy fixes. Defects are handed to the developer agent.
10. It must retest fixed defects and run the relevant regression section.

## 12. Defect Template

| Field | Required content |
|---|---|
| Defect ID | `CA-UAT-###` |
| Test ID | Related checklist ID |
| Severity | P0/P1/P2 |
| Environment/revision | Staging URL and commit |
| Preconditions | User, balance, configuration |
| Steps | Exact reproducible steps |
| Expected | Expected behavior |
| Actual | Observed behavior |
| Evidence | Screenshots/video/log/task ID |
| Billing impact | Quote, reservation, settlement/refund |
| Data impact | Records affected |
| Workaround | If available |
| Retest status | Not fixed/Ready/Pass/Fail |

## 13. Execution Report

| Test ID | Priority | Cost class | Result | Tester | Date/time MYT | Evidence | Actual result | Defect ID |
|---|---|---|---|---|---|---|---|---|
|  |  |  | Not run |  |  |  |  |  |

## 14. Exit Criteria

- All P0 tests pass.
- All core P1 workflows pass or have documented owner-approved exceptions.
- No unexplained provider charge or credit mismatch remains.
- No cross-user or unauthorized admin access is possible.
- Generated final/raw/SRT media remain available after provider URL expiry.
- Paid generation, research, publishing, email, and Stripe test evidence is complete.
- Open P2 defects are documented and accepted.
- UAT agent produces a signed execution summary with tested commit and deployment run.
