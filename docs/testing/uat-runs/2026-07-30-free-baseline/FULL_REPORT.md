# ContentAgent Staging UAT - Free Baseline

**Execution date:** 2026-07-30 (MYT, UTC+08:00)  
**Plan:** `docs/UAT_TEST_PLAN_CURRENT_BUILD.md`, revision 2, 170 cases  
**Execution mode:** Independent, non-destructive, no-spend baseline  
**Decision:** **NOT READY FOR PAID OR PRODUCTION-SIDE-EFFECT UAT**

## Executive Summary

The staging frontend, admin, and API were exercised using browser, API, deployment,
and static/runtime inspection. No Kie, Apify, email, social publishing, Stripe
Checkout, live-money, destructive, or deployment action was triggered.

| Status | Count |
|---|---:|
| Pass | 45 |
| Fail | 19 |
| Blocked | 93 |
| Not applicable | 13 |
| **Total** | **170** |

| Priority | Pass | Fail | Blocked | N/A | Total |
|---|---:|---:|---:|---:|---:|
| P0 | 13 | 9 | 27 | 2 | 51 |
| P1 | 32 | 9 | 65 | 11 | 117 |
| P2 | 0 | 1 | 1 | 0 | 2 |

The most important result is release drift: all deployed staging services run
commit `77c267136abfcb707915f8d5c70b44eec98a18cf`, while the staging branch is
`c54aa67de0342f6f9df6d733648e00fce9f86c79`. Product Video Studio and later
application commits are not deployed.

## Deployment Baseline

| Surface | Revision | Image commit |
|---|---|---|
| Frontend | `contentagent-social-staging-00069-czq` | `77c267136abfcb707915f8d5c70b44eec98a18cf` |
| Admin | `contentagent-admin-staging-00054-bls` | `77c267136abfcb707915f8d5c70b44eec98a18cf` |
| API | `contentagent-api-staging-00100-f26` | `77c267136abfcb707915f8d5c70b44eec98a18cf` |

Latest successful deployment workflow:
`https://github.com/adrentan888-adren/cabuild/actions/runs/30524341392`

All three deployed surfaces are mutually aligned, but they are behind the branch
being presented as the current staging build. See
[`evidence/DEPLOYMENT_BASELINE.txt`](evidence/DEPLOYMENT_BASELINE.txt).

## Scope and Safety

Executed:

- Frontend/admin navigation and current-state inspection
- Authentication validation and normalization without sending email
- Unauthenticated API, CORS, route, and token-tampering checks
- Cached Research history, sorting, preview, and non-first-row selection
- Create Content format/model/reference/quote behavior
- Extreme-aspect-ratio image preparation using a harmless local fixture
- Existing video preview and applicable download controls
- Billing/ledger, admin rate mapping, API-key masking, and log inspection
- Static/runtime review of captioning, polling, security, and candidate Product
  Video paths

Not executed:

- Any Kie or Apify provider invocation
- Verification email
- Upload-Post connection or social publishing
- Stripe Checkout/webhook side effects
- Live-money activity
- User/history/config deletion
- Deployment or application-code modification

## P0 Defects

### CA-UAT-001 - Deployed staging is behind the current branch

**Severity:** P0  
**Ownership:** Release engineering / CI-CD

**Steps:** Compare branch HEAD and deployed Cloud Run image metadata; inspect the
frontend navigation.  
**Expected:** Intended branch commit is deployed on frontend, admin, and API.  
**Actual:** Services run `77c2671`; branch HEAD is `c54aa67`; Product Video Studio
is absent. Later `[skip ci]` commits prevented a deployment workflow at branch tip.  
**Evidence:** [`evidence/DEPLOYMENT_BASELINE.txt`](evidence/DEPLOYMENT_BASELINE.txt)

### CA-UAT-002 - Staging shares production secrets and service identity

**Severity:** P0  
**Ownership:** Cloud platform / security

**Steps:** Compare staging and production Cloud Run configuration and scheduler
resources.  
**Expected:** Staging writes and external calls are isolated from production.  
**Actual:** Database and bucket are separate, but application/session secret,
provider secret references, service identity, and automation secret are shared.  
**Evidence:** [`evidence/API_AND_SECURITY_CHECKS.md`](evidence/API_AND_SECURITY_CHECKS.md)

### CA-UAT-003 - API health endpoints return 404

**Severity:** P0  
**Ownership:** API / platform

**Steps:** Request staging API `/healthz` and `/health`.  
**Expected:** A stable, unauthenticated health response without 5xx.  
**Actual:** Both routes return HTTP 404.  
**Evidence:** [`evidence/API_AND_SECURITY_CHECKS.md`](evidence/API_AND_SECURITY_CHECKS.md)

### CA-UAT-004 - Legacy backend credentials are rendered to the admin client

**Severity:** P0  
**Ownership:** Admin backend / security

**Steps:** Sign in as owner, open Prompt Management, inspect the legacy backend
credential fields and client response.  
**Expected:** Secrets are never returned to or prefilled in the browser.  
**Actual:** A known-default legacy username/password pair is rendered client-side.
The report intentionally redacts the values.  
**Evidence:** [`evidence/ADM-Prompt_Management.png`](evidence/ADM-Prompt_Management.png)

### CA-UAT-005 - Public media tokens do not enforce workspace authorization

**Severity:** P0  
**Ownership:** Media API / security

**Steps:** Inspect `/api/public-uploads/[token]`; test malformed and altered tokens.  
**Expected:** Signed/expiring token or authenticated workspace authorization.  
**Actual:** Random tokens return 404, but valid tokens are reversible base64url
storage keys. Any holder or derivation of another valid key can retrieve that
object without a workspace check.  
**Evidence:** [`evidence/API_AND_SECURITY_CHECKS.md`](evidence/API_AND_SECURITY_CHECKS.md)

### CA-UAT-006 - Invalid image selection is not rejected safely

**Severity:** P0  
**Ownership:** Frontend upload / upload API

**Steps:** Select a wrong-type executable file as a product image.  
**Expected:** Visible validation; no upload, asset, billing, or provider task.  
**Actual:** Browser image decoding throws an unhandled exception and no actionable
message appears. Server upload validation also does not enforce image dimensions.  
**Evidence:** [`evidence/STATIC_RUNTIME_FINDINGS.md`](evidence/STATIC_RUNTIME_FINDINGS.md)

### CA-UAT-014 - Candidate Product Video path bypasses core controls

**Severity:** P0  
**Ownership:** Product Video / billing / API security

**Steps:** Inspect current-branch Product Video direct routes and compare with the
main generation pipeline.  
**Expected:** Owned tasks, CA credit reservation/settlement, current global
guardrail, durable jobs, and logs.  
**Actual:** Candidate direct Kie calls bypass CA credits; status accepts arbitrary
syntactically valid task IDs without workspace ownership; the admin-managed
guardrail is not used. The surface is not deployed.  
**Evidence:** [`evidence/STATIC_RUNTIME_FINDINGS.md`](evidence/STATIC_RUNTIME_FINDINGS.md)

### CA-UAT-015 - Current candidate workspace does not build cleanly

**Severity:** P0  
**Ownership:** Repository/build engineering

**Steps:** Build current workspace with the bundled project runtime.  
**Expected:** Clean production build.  
**Actual:** Type checking includes the nested `avatarvideo` application and fails
on a missing export. The build also reports extensive `CABuild`/`CAbuild` path
casing conflicts. No source file was changed by UAT.  
**Evidence:** Static execution record in this report.

### CA-UAT-017 - Caption post-processing failure is marked Done

**Severity:** P0  
**Ownership:** Video pipeline / billing

**Steps:** Inspect failure handling around media download, SRT storage, FFmpeg, and
final storage.  
**Expected:** Raw output retained; final item remains failed/fallback with visible
post-processing status and documented billing treatment.  
**Actual:** Persistence falls back to the temporary provider URL and callers still
set asset `ready` and queue `done`, only recording a hidden storage-error field.  
**Evidence:** [`evidence/STATIC_RUNTIME_FINDINGS.md`](evidence/STATIC_RUNTIME_FINDINGS.md)

## P1 Defects

### CA-UAT-007 - Voice references cannot be audited by playback

**Ownership:** Persona / Create Content  
Recorded/uploaded audio has no player, duration, or MIME/download details.
Unsupported `MediaRecorder` environments are also reported as permission errors.  
**Evidence:** [`evidence/STATIC_RUNTIME_FINDINGS.md`](evidence/STATIC_RUNTIME_FINDINGS.md)

### CA-UAT-008 - Cached strict URL scan contains unrelated sources

**Ownership:** Research / Apify adapter  
An Instagram profile scan contains Skool, Reddit, Trustpilot, and placeholder
media. A fresh paid confirmation run was intentionally not started.  
**Expected:** URL scans contain only posts from the submitted profile/page.  
**Evidence:** [`evidence/DEP-03-Research.png`](evidence/DEP-03-Research.png)

### CA-UAT-010 - Failed videos still display “Generating video”

**Ownership:** My Contents  
Existing rows with status `failed` and a provider validation error still render a
generation placeholder, creating a false in-progress state.  
**Evidence:** [`evidence/CON-01-VID-11-video-preview.png`](evidence/CON-01-VID-11-video-preview.png)

### CA-UAT-011 - Preview modal lacks focus and dialog behavior

**Ownership:** Frontend accessibility  
Focus remains on the trigger; the modal has no dialog semantics, focus trap,
Escape handling, or reliable focus return.  
**Evidence:** [`evidence/CON-01-VID-11-video-preview.png`](evidence/CON-01-VID-11-video-preview.png)

### CA-UAT-012 - Home Research metric does not reconcile

**Ownership:** Home metrics / API aggregation  
Home reports zero research scans while Research exposes two history entries and
nine qualified results.  
**Evidence:** [`evidence/HOME_METRIC_RECONCILIATION.txt`](evidence/HOME_METRIC_RECONCILIATION.txt),
[`evidence/DEP-03-Research.png`](evidence/DEP-03-Research.png)

### CA-UAT-013 - Analytics engagement forecast is hard-coded

**Ownership:** Analytics  
The displayed forecast is a fixed `4.8%`, not derived from source records.  
**Evidence:** [`evidence/STATIC_RUNTIME_FINDINGS.md`](evidence/STATIC_RUNTIME_FINDINGS.md)

### CA-UAT-016 - Refresh discards the selected module

**Ownership:** Frontend routing/state  
Refreshing while on Research returns to Home; module state is not represented in
the URL or restored.  
**Evidence:** [`evidence/STATIC_RUNTIME_FINDINGS.md`](evidence/STATIC_RUNTIME_FINDINGS.md)

### CA-UAT-018 - Completed-task post-processing is not idempotent

**Ownership:** Video pipeline  
Repeated polling of an already completed provider task has no server-side lock or
completion short-circuit and can repeat download, FFmpeg, and storage work.  
**Evidence:** [`evidence/STATIC_RUNTIME_FINDINGS.md`](evidence/STATIC_RUNTIME_FINDINGS.md)

### CA-UAT-019 - Empty caption creates an empty SRT artifact

**Ownership:** Video pipeline / My Contents  
An empty caption reuses raw as final but still stores an empty SRT object, which
can make subtitle controls imply that captions exist.  
**Evidence:** [`evidence/STATIC_RUNTIME_FINDINGS.md`](evidence/STATIC_RUNTIME_FINDINGS.md)

### CA-UAT-020 - Image normalization is only client-side

**Ownership:** Upload API / automation  
The browser scales and pads correctly, but `/api/uploads` does not enforce the
same dimensions/aspect ratio. Direct, automation, or legacy callers can bypass
provider-safe preparation.  
**Evidence:** [`evidence/MEDIA_NORMALIZATION_RESULT.txt`](evidence/MEDIA_NORMALIZATION_RESULT.txt),
[`evidence/STATIC_RUNTIME_FINDINGS.md`](evidence/STATIC_RUNTIME_FINDINGS.md)

## P2 Defect

### CA-UAT-009 - Research contains corrupted separator characters

**Ownership:** Frontend encoding/data normalization  
Dates and descriptions visibly include malformed replacement characters.  
**Evidence:** [`evidence/DEP-03-Research.png`](evidence/DEP-03-Research.png)

## Confirmed Behaviors

- Frontend, admin, and API deployed services share one compatible image commit.
- Main frontend modules load without blank states at desktop width.
- Valid auth works; invalid/unknown identities receive the same generic error.
- Email normalization works for login and duplicate registration checks.
- Logout blocks protected admin reuse.
- CORS does not grant an untrusted origin.
- Research platform/content-type controls, two-way sorting, cached history,
  in-app source preview, and non-first-row selection work.
- Create Content shows Seedance 2.0 Mini and Seedance 2.0 only; Veo is absent.
- Video/image/text type switching updates models, dimensions, and visible credit
  quotes.
- A 3.70-ratio reference image is proportionally scaled and padded to 2.50,
  without stretch or crop.
- Existing historical video opens in-app with native playback and final download.
- Existing assets without raw/SRT correctly hide unavailable controls.
- Visible logs did not expose API keys, passwords, cookies, tokens, or verification
  codes.
- Admin API-key inputs are blank password fields; active Seedance mappings are
  enabled and Veo is inactive.

## Blockers and Required Approval

| Blocked class | Count | Approval / prerequisite |
|---|---:|---|
| Paid Kie | 20 | Capped Kie budget, expected maximum credits/USD, disposable user, and stop limit |
| Paid Apify | 7 | Capped actor budget, approved queries/URLs, expected maximum credits/USD |
| Combined Apify/Kie | 1 | Both capped budgets plus a disposable Persona fixture |
| Generic paid provider | 1 | Named provider, capped amount, and disposable fixture |
| Email | 3 | Permission to send to a disposable inbox |
| Publish | 3 | Isolated social test accounts and explicit permission to create/delete posts |
| Stripe test | 2 | Disposable Stripe test customer and approval for Checkout/webhook/ledger side effects |
| Destructive | 2 | Disposable records, backup confirmation, and cleanup authorization |
| FREE fixture/config/device gaps | 54 | Disposable users/roles/data, safe failure hooks, real mobile/mic/browser coverage, or explicit shared-config mutation approval |

## Recommended Next Wave

1. Fix CA-UAT-001 through CA-UAT-006, CA-UAT-014, CA-UAT-015, and CA-UAT-017.
2. Deploy one explicit commit to all staging surfaces and confirm `/healthz`.
3. Separate staging provider/session secrets and service identity from production.
4. Re-run the full FREE suite with two disposable users, one restricted admin,
   mobile/tablet browsers, microphone access, and safe provider failure hooks.
5. After the FREE P0 gate passes, approve one capped paid wave: Research URL and
   keyword cases, one generation per content type/model boundary, and one
   captioned raw/final/SRT video.
6. Run Stripe test-mode and isolated Upload-Post publishing only after provider
   and billing reconciliation are green.

## Artifacts

- Full case results: [`RESULTS.csv`](RESULTS.csv)
- Deployment baseline: [`evidence/DEPLOYMENT_BASELINE.txt`](evidence/DEPLOYMENT_BASELINE.txt)
- API/security checks: [`evidence/API_AND_SECURITY_CHECKS.md`](evidence/API_AND_SECURITY_CHECKS.md)
- Static/runtime findings: [`evidence/STATIC_RUNTIME_FINDINGS.md`](evidence/STATIC_RUNTIME_FINDINGS.md)
- Screenshots: [`evidence/`](evidence/)

No credentials or secret values are included in this report or its evidence.
