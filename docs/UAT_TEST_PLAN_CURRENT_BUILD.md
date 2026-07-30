# ContentAgent Current-Build UAT Test Plan

## 1. Document Control

| Field | Value |
|---|---|
| Product | ContentAgent |
| Environment | Staging only |
| Branch | `staging/admin-split` |
| Baseline commit | Record the deployed commit before execution |
| Time zone | Asia/Kuala_Lumpur (MYT) |
| Plan owner | Developer agent |
| Executor | Independent UAT agent or assigned human tester |
| Production changes | Prohibited during UAT |

This plan covers the complete current staging application: frontend, admin backend, API, authentication, integrations, billing, automation, generated-media history, Product Video Studio, and post-production caption handling.

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
- Microphone access allowed and denied scenarios.
- Video prompts for 9:16 and 16:9.
- Image prompts for 1:1, 4:5, 16:9, and 9:16.
- Text-post prompt.
- Caption containing punctuation, Malay/English text, and line wrapping.

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

### C. Home

| ID | Pri | Cost | Test | Expected result |
|---|---|---|---|---|
| HOME-01 | P1 | FREE | Validate every metric against source records | Values are real and reconcile with Research, My Contents, Automation, and Billing |
| HOME-02 | P1 | FREE | Use Create Content action | Opens the reviewable Create Content workflow, not immediate paid generation |
| HOME-03 | P2 | FREE | Empty/new account | Meaningful zero states; no fake metrics |

### D. Social Audit

| ID | Pri | Cost | Test | Expected result |
|---|---|---|---|---|
| AUD-01 | P1 | FREE | Connect social media | Upload-Post connection page opens directly |
| AUD-02 | P1 | PAID-APIFY | Audit connected accounts | Progress shown immediately; user may leave and return |
| AUD-03 | P1 | PAID-APIFY | Validate metrics and account breakdown | Results correspond to connected handles and mock-UI fields |
| AUD-04 | P1 | FREE | Provider failure/zero quota | Clear failure, no fake result, correct credit release |
| AUD-05 | P1 | FREE | Reload after completed audit | Audit history persists |

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

### H. Video Prompt and Caption Post-Production

| ID | Pri | Cost | Test | Expected result |
|---|---|---|---|---|
| VID-01 | P1 | FREE | Review backend Global Video Generation Rules | Rule forbids generated words, numbers, URLs, labels, subtitles, and signs except uploaded logo |
| VID-02 | P1 | FREE | Edit rule and create a queued video | Latest saved rule appears in final provider prompt |
| VID-03 | P1 | PAID-KIE | Generate video with caption | Seedance raw output completes, FFmpeg creates captioned final MP4 |
| VID-04 | P1 | PAID-KIE | Open My Contents preview | Final captioned video plays by default |
| VID-05 | P1 | PAID-KIE | Download final MP4 | Downloaded file is playable MP4 with captions |
| VID-06 | P1 | PAID-KIE | Download raw MP4 | File is original provider video without burned captions |
| VID-07 | P1 | PAID-KIE | Download `.srt` | Valid numbered cues, timestamps, UTF-8 text, and correct duration |
| VID-08 | P1 | PAID-KIE | Caption with Malay, punctuation, and long wrapping | Readable, safe-area caption; no clipping or encoding corruption |
| VID-09 | P1 | PAID-KIE | Video with empty caption | Final remains playable; raw download works; subtitle behavior is explicit |
| VID-10 | P0 | FREE | Simulate FFmpeg failure | Asset is not falsely marked done; error is logged and credits follow policy |
| VID-11 | P1 | FREE | Existing historical video | Remains playable; unavailable raw/SRT controls are hidden |

### I. My Contents and Publishing

| ID | Pri | Cost | Test | Expected result |
|---|---|---|---|---|
| CON-01 | P1 | FREE | Generating item polling | Status progresses automatically without Poll button |
| CON-02 | P1 | FREE | Preview image/video/text | Opens in app instead of forced download |
| CON-03 | P1 | FREE | Reload and redeploy | All content history remains |
| CON-04 | P1 | PUBLISH | Publish each supported type to test accounts | Correct asset, caption, hashtags, and selected placement are posted |
| CON-05 | P1 | FREE | Publishing failure | Clear error, retry path, no duplicate post |
| CON-06 | P0 | FREE | Cross-user history access | Other user's assets and download URLs are inaccessible |

### J. Product Video Studio

| ID | Pri | Cost | Test | Expected result |
|---|---|---|---|---|
| PVS-01 | P1 | FREE | Open module and review required fields | Current CA layout is coherent and responsive |
| PVS-02 | P1 | FREE | Validate files, ratios, durations, and model choices | Invalid submissions blocked before provider call |
| PVS-03 | P1 | PAID-KIE | Generate product video | Correct provider task, progress, output, billing, and logs |
| PVS-04 | P1 | FREE | Leave and return during generation | Job continues and status restores |
| PVS-05 | P1 | FREE | Failure and retry | Failure visible; retry does not duplicate charges or history |

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

### M. Analytics, Logs, and Settings

| ID | Pri | Cost | Test | Expected result |
|---|---|---|---|---|
| OBS-01 | P1 | FREE | Compare analytics to source records | Counts and usage are real and reconcilable |
| OBS-02 | P1 | FREE | Inspect generation log | Sanitized prompt, model, duration, references, task ID, and result URL recorded |
| OBS-03 | P0 | FREE | Inspect logs for secrets | No raw API keys, passwords, tokens, cookies, or verification codes |
| OBS-04 | P1 | FREE | Save settings and reconnect integrations | Values persist and health status updates |

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

