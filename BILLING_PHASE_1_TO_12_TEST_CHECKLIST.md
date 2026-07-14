# ContentAgent Billing: Phase 1-12 Test Checklist

Use this checklist on staging before promoting billing changes to production.

## Test Labels

- **FREE**: local/app/Stripe test-mode validation; no Kie or Apify usage.
- **PAID API**: consumes Kie, Apify, or another provider balance.
- **LIVE MONEY**: creates a real Stripe payment or refund. Run only with explicit approval.

## Priority and Result Codes

- **P0**: financial integrity, authorization, payment, credit balance, or data-loss risk. Must pass before promotion.
- **P1**: core workflow, recovery, audit, and user-facing billing behavior. Must pass or have an approved exception.
- **P2**: secondary usability, reporting presentation, and uncommon edge behavior.
- Result values: `Not run`, `Pass`, `Fail`, `Blocked`, `Not applicable`, or `Accepted risk`.

## Execution Record Template

Copy this row for every executed test:

| Test ID | Priority | Result | Environment | Commit/revision | Tester | Date/time MYT | Evidence link/path | Actual result | Defect ID |
|---|---|---|---|---|---|---|---|---|---|
| P1-01 | P0 | Not run | Staging |  |  |  |  |  |  |

Required evidence for P0/P1 tests:

- Before/after screenshots for user-facing state.
- Relevant request status and sanitized response body.
- Before/after credit balance and matching ledger row IDs.
- Stripe event/order/payment/subscription IDs where applicable; never capture card details or raw keys.
- Provider task/run ID for Kie, Apify, or Upload-Post work.
- Debug/activity log entry showing actor, action, timestamp, and result.
- Database backup identifier for destructive or reconciliation-fixture tests.

## Test Setup

- [ ] Record the deployment commit, GitHub Actions run, deployment time, and staging URLs.
- [ ] Confirm frontend, Admin, and API health endpoints return HTTP 200.
- [ ] Use a dedicated verified staging user and record its starting credit balance.
- [ ] Keep Stripe in test mode except for the explicitly approved Phase 11 live smoke test.
- [ ] Take a database backup before destructive, refund, discrepancy, or close-period tests.
- [ ] Record each test as `Pass`, `Fail`, `Blocked`, or `Not run`, with evidence and notes.

### Required Test Identities

- [ ] Owner or super-admin with every billing, Stripe, and finance permission.
- [ ] Admin with billing management but without live-launch approval.
- [ ] Finance admin with view/reconcile/export/resolve but without period-close permission.
- [ ] Support admin with read-only billing/finance access.
- [ ] Verified standard user with normal credits.
- [ ] Verified standard user with zero credits.
- [ ] Verified standard user just below the low-credit and automation thresholds.
- [ ] Disabled user and unverified user for authentication/Checkout rejection tests.
- [ ] Two users in different workspaces or ownership contexts for isolation tests.

### Required Balance Fixtures

- [ ] Zero balance.
- [ ] Balance exactly equal to the quote.
- [ ] Balance one credit below the quote.
- [ ] Balance above the quote with an active reservation.
- [ ] Positive grants with different expiry dates.
- [ ] Fully consumed grant.
- [ ] Fully and partially refunded purchase.
- [ ] Admin-added and admin-removed credits.
- [ ] Deliberately inconsistent local fixture for isolated reconciliation tests only.

### Required Provider Fixtures

- [ ] Successful immediate provider response.
- [ ] Successful asynchronous provider task.
- [ ] Provider rejects before accepting work.
- [ ] Provider accepts work and later fails.
- [ ] Provider timeout and malformed response.
- [ ] Duplicate completion callback/poll result.
- [ ] Expired temporary provider media URL.
- [ ] Apify run with zero, one, and many results.
- [ ] Stripe test charge settled in USD and one settled in a non-USD account currency.

### Data Safety Rules

- [ ] Never use production provider keys for failure injection.
- [ ] Never edit a real staging ledger row to manufacture a test; use isolated local data or dedicated fixture APIs/scripts.
- [ ] Never close a real finance period until the report has been reviewed.
- [ ] Never perform Phase 11 live-money cases without written approval and an agreed refund owner.
- [ ] Redact passwords, API keys, webhook secrets, card data, session cookies, and full personal data from evidence.

## Phase 1: Billing Foundation

- [ ] **P1-01 FREE**: Open Admin -> Billing and confirm 3 plans, 5 top-up packages, rate cards, provider mappings, and the credit ledger load.
- [ ] **P1-02 FREE**: Grant credits to a test user. Expected: one append-only admin-adjustment ledger row and the exact balance increase.
- [ ] **P1-03 FREE**: Remove credits with a reason. Expected: one negative adjustment row and no unexplained balance change.
- [ ] **P1-04 FREE**: Add an expiring grant. Expected: credits count before expiry and stop counting after expiry.
- [ ] **P1-05 FREE**: Verify active reservations reduce available balance without changing lifetime usage.
- [ ] **P1-06 FREE**: Quote VEO Fast. Expected default quote: 600 credits at the configured Phase 1 rate.
- [ ] **P1-07 FREE**: Quote Seedance 2.0 for 8 seconds. Expected default quote: 3,280 credits.
- [ ] **P1-08 FREE**: Quote GPT Image 2 and Nano Banana Pro resolutions. Expected: model/rate-card-specific integer credits rounded up.
- [ ] **P1-09 FREE**: Quote an Apify action. Expected: estimate/minimum/maximum fields reflect variable result cost.
- [ ] **P1-10 FREE**: Attempt to edit/delete an existing ledger row through supported UI/API. Expected: no operation exists; corrections create new rows.

## Phase 2: Frontend Credit Display

- [ ] **P2-01 FREE**: Check credit labels on Research Search/Scan, Social Audit, Persona Auto-fill, Create Content AI fill/final Generate, and Automation Run Now.
- [ ] **P2-02 FREE**: Change video model. Expected: button credit estimate refreshes from the backend quote.
- [ ] **P2-03 FREE**: Change Seedance duration. Expected: estimated credits change proportionally.
- [ ] **P2-04 FREE**: Change image model/resolution. Expected: image quote changes to the selected rate card.
- [ ] **P2-05 FREE**: Change platform/result limit in Research. Expected: variable estimate or maximum refreshes.
- [ ] **P2-06 FREE**: Reduce test balance below the quote. Expected: action is disabled, required/current credits are shown, and Buy Credits is available.
- [ ] **P2-07 FREE**: Inspect the quote request/response. Expected: frontend displays the server quote and does not calculate final pricing itself.
- [ ] **P2-08 FREE**: Start a paid action. Expected: UI changes immediately to running/reserved feedback and prevents duplicate clicks.

## Phase 3: Metering Enforcement

- [ ] **P3-01 FREE**: Disable/remove a test action's rate card and call the paid route. Expected: backend blocks before provider invocation.
- [ ] **P3-02 FREE**: Run with insufficient credits. Expected: HTTP rejection, no provider task, no negative balance.
- [ ] **P3-03 FREE**: Start a valid paid action with a mocked provider. Expected: reservation is written before provider call.
- [ ] **P3-04 FREE**: Complete the mocked provider call. Expected: reservation becomes released and one usage row settles the charge.
- [ ] **P3-05 FREE**: Fail before provider acceptance. Expected: full reservation release and no usage charge.
- [ ] **P3-06 FREE**: Fail after provider acceptance. Expected: configured refund/release/manual-review policy is recorded.
- [ ] **P3-07 FREE**: Retry the same completion callback. Expected: no duplicate settlement.
- [ ] **P3-08 FREE**: Confirm logs include action, model/actor, quote, reserved/final credits, provider task ID, and error/result.

## Phase 4: Create Content Metering and Retention

- [ ] **P4-01 PAID API**: Generate VEO Fast video. Expected: correct quote, one reservation, one settlement, playable output in My Contents.
- [ ] **P4-02 PAID API**: Generate Seedance 2.0 at every supported duration. Expected: duration-based charge and matching provider payload.
- [ ] **P4-03 PAID API**: Generate GPT Image 2 at each supported resolution/dimension. Expected: correct charge and viewable image.
- [ ] **P4-04 PAID API**: Generate Nano Banana Pro at each supported resolution/dimension. Expected: correct charge and viewable image.
- [ ] **P4-05 PAID API**: Generate text with Gemini, GPT-5.5, and Claude. Expected: correct selected model, normalized text output, and token estimate settlement.
- [ ] **P4-06 PAID API**: Run Fill Fields with AI and Research -> Generate Content. Expected: each independently quoted and metered.
- [ ] **P4-07 PAID API**: Use Create Again. Expected: a new task and charge, while the previous output remains in history.
- [ ] **P4-08 FREE**: Simulate provider failure. Expected: status becomes Failed and reservation follows refund policy.
- [ ] **P4-09 PAID API**: Complete image/video generation and inspect URL. Expected: app-owned GCS/public-upload URL is stored, not only an expiring Kie URL.
- [ ] **P4-10 FREE**: Reopen retained media after restart/deployment. Expected: preview and download still work.

## Phase 5: Research, Persona, and Social Audit Metering

- [ ] **P5-01 PAID API**: Run Research keyword search. Expected: reserve before Apify, settle after results, and result-count metadata in ledger.
- [ ] **P5-02 PAID API**: Run Research URL scan and leave the page. Expected: scan continues, then settles once when synchronized.
- [ ] **P5-03 FREE**: Reopen a cached Research scan. Expected: cached results load with no new Apify reservation/charge.
- [ ] **P5-04 FREE**: Simulate failed Apify run. Expected: reservation is released and failure is logged.
- [ ] **P5-05 PAID API**: Run Persona Auto-fill. Expected: composite quote shows crawl plus GPT mapping; successful components settle separately.
- [ ] **P5-06 FREE**: Force Persona crawl fallback. Expected: failed/unused Apify reservation releases; only successful paid work is charged.
- [ ] **P5-07 PAID API**: Run connected-account Social Audit. Expected: paid provider work settles from actual results.
- [ ] **P5-08 FREE**: Run Social Audit using only local scoring/fallback. Expected: no provider usage charge.
- [ ] **P5-09 FREE**: Verify Research/Social Audit history survives deployment and does not create duplicate charges.

## Phase 6: Automation Billing Safety

- [ ] **P6-01 FREE**: Try enabling automation below the minimum balance. Expected: blocked or auto-paused with clear reason.
- [ ] **P6-02 FREE**: Set a per-run cap below the quoted maximum. Expected: run is skipped before provider calls.
- [ ] **P6-03 FREE**: Reach daily cap. Expected: later due runs skip and create audit logs.
- [ ] **P6-04 FREE**: Reach monthly cap. Expected: further runs stop until the next billing period/admin change.
- [ ] **P6-05 FREE**: Trigger low-balance auto-pause. Expected: watcher/rule status becomes paused and records last error/skip time.
- [ ] **P6-06 PAID API**: Run Source Watcher manually. Expected: crawl, AI, generation, and publish actions are independently metered.
- [ ] **P6-07 PAID API**: Test draft-only, generate-for-approval, schedule, and auto-publish modes. Expected: only actions used by that mode are charged.
- [ ] **P6-08 PAID API**: Auto-publish through Upload-Post. Expected: connected account is used and publishing follows configured included/per-post billing.
- [ ] **P6-09 FREE**: Trigger the cron twice for the same due job. Expected: no duplicate provider task, asset, publish, or charge.

## Phase 7: User Billing Tab

- [ ] **P7-01 FREE**: Confirm user sees available/reserved credits and current plan.
- [ ] **P7-02 FREE**: Confirm subscription, top-up, bonus, usage, and reserved totals match ledger entries.
- [ ] **P7-03 FREE**: Filter usage by module. Expected: totals and rows update correctly.
- [ ] **P7-04 FREE**: Filter usage by provider. Expected: totals and rows update correctly.
- [ ] **P7-05 FREE**: Confirm payment/top-up history is chronological and contains no secret/card data.
- [ ] **P7-06 FREE**: Lower balance below warning thresholds. Expected: low-credit and automation warnings appear.
- [ ] **P7-07 FREE**: Confirm Subscribe and Buy Credits CTAs show only active plans/packages.
- [ ] **P7-08 FREE**: Check desktop/mobile layout for clipping, overflow, or inaccessible controls.

## Phase 8: Admin Billing Management

- [ ] **P8-01 FREE**: Edit plan name, price, base credits, bonus, expiry, automation allowance, and concurrency. Expected: save persists and logs an audit event.
- [ ] **P8-02 FREE**: Edit each top-up package field. Expected: total credits recalculate correctly.
- [ ] **P8-03 FREE**: Edit rate-card cost, unit, markup, and minimum. Expected: subsequent quote changes automatically.
- [ ] **P8-04 FREE**: Change a provider mapping. Expected: feature quote/provider selection follows mapping without feature-code changes.
- [ ] **P8-05 FREE**: Filter ledger by user/module/provider and confirm exact matching rows.
- [ ] **P8-06 FREE**: Adjust user credits and verify balance, ledger, activity, and debug logs.
- [ ] **P8-07 FREE**: Change daily/monthly caps, refund policy, and concurrency. Expected: enforcement uses new settings.
- [ ] **P8-08 FREE**: Verify API keys remain masked and raw secrets are never returned by Admin APIs.
- [ ] **P8-09 FREE**: Test role permissions. Expected: view-only admin cannot edit/delete; authorized admin can perform assigned actions.

## Phase 9: Provider Pricing Sync

- [ ] **P9-01 PAID/NETWORK**: Sync Kie pricing. Expected: run record, scan count, timestamp, and review items where prices differ.
- [ ] **P9-02 FREE**: Confirm a sync proposal does not change an active rate card before approval.
- [ ] **P9-03 FREE**: Approve a pricing alert. Expected: rate card changes once, quote changes, decision is audited.
- [ ] **P9-04 FREE**: Reject/Keep Manual on an alert. Expected: current rate remains and decision persists.
- [ ] **P9-05 PAID/NETWORK**: Sync Apify actor metadata. Expected: supported pricing is proposed; unavailable pricing becomes `manual_required`.
- [ ] **P9-06 FREE**: Add a new provider model/rate/mapping. Expected: quote API and frontend label work without editing feature code.
- [ ] **P9-07 FREE**: Manually edit a provider-synced rate. Expected: sync/review status reflects the manual override.

## Phase 10: Stripe Test Mode

- [ ] **P10-01 FREE**: Confirm Stripe test key connects only to test mode and live/test webhook events cannot cross modes.
- [ ] **P10-02 STRIPE TEST**: Buy a top-up through Checkout. Expected: paid order and exactly one purchase grant.
- [ ] **P10-03 STRIPE TEST**: Subscribe to a plan. Expected: Checkout order, active subscription, invoice record, and one period grant.
- [ ] **P10-04 FREE**: Replay the same signed webhook. Expected: duplicate is acknowledged and no duplicate credits are granted.
- [ ] **P10-05 FREE**: Send invalid signature. Expected: HTTP 400 and no state change.
- [ ] **P10-06 STRIPE TEST**: Send invoice payment failure. Expected: subscription/payment status updates and no new credits.
- [ ] **P10-07 STRIPE TEST**: Cancel at period end through Customer Portal. Expected: state syncs without deleting history.
- [ ] **P10-08 STRIPE TEST**: Fully and partially refund a top-up. Expected: proportional negative refund ledger row and matching available-credit reduction.
- [ ] **P10-09 FREE**: Confirm fully refunded order remains traceable as paid then refunded.

## Phase 10.5: Backend-Managed Stripe Setup

- [ ] **P10.5-01 FREE**: Connect/validate the test Stripe account from Admin. Expected: account ID, country, currency, charges/payouts, and webhook status display without raw keys.
- [ ] **P10.5-02 STRIPE TEST**: Sync catalogue. Expected: 3 plans + 5 packages, each with active product/price/mapping/revision.
- [ ] **P10.5-03 FREE**: Change an app offer after creating Checkout. Expected: existing order keeps its immutable amount/credits revision.
- [ ] **P10.5-04 FREE**: Verify test and live credentials, customers, catalogue mappings, and webhook URLs remain isolated.
- [ ] **P10.5-05 FREE**: Test Stripe permissions for connect, catalogue, events, migration, and disconnect.
- [ ] **P10.5-06 FREE**: Disconnect test Stripe. Expected: new Checkout stops; financial/catalogue history remains.
- [ ] **P10.5-07 FREE**: Confirm unsupported existing-subscription migrations remain blocked until explicitly approved/tested.
- [ ] **P10.5-08 FREE**: Run `npm run test:stripe-phase10.5` and `npm run test:stripe-phase10.5-ui`.

## Phase 11: Controlled Live Launch

- [ ] **P11-01 FREE**: Attempt live connection before readiness approval. Expected: server blocks it.
- [ ] **P11-02 FREE**: Complete all readiness checks with evidence and approve. Expected: approval actor/time persist.
- [ ] **P11-03 FREE**: Compare test/live catalogue. Expected: all 8 offers match before catalogue approval.
- [ ] **P11-04 FREE**: Run live preflight. Expected: keys, webhook, catalogue, rollout, and safety checks pass.
- [ ] **P11-05 FREE**: Enable owner-only rollout. Expected: owner can open Checkout; normal user receives HTTP 403.
- [ ] **P11-06 LIVE MONEY**: Owner buys the smallest top-up. Expected: receipt, paid order, and one exact credit grant.
- [ ] **P11-07 LIVE MONEY**: Owner buys the smallest subscription. Expected: invoice, subscription, and one period grant.
- [ ] **P11-08 LIVE MONEY**: Open Portal, cancel renewal, and issue refund. Expected: state sync and exact credit reversal.
- [ ] **P11-09 FREE**: Save/approve the redacted live smoke report. Expected: references valid paid/refunded orders without card data.
- [ ] **P11-10 FREE**: Expand to allowlist. Expected: only selected users can purchase.
- [ ] **P11-11 FREE**: Trigger emergency stop. Expected: new Checkout stops immediately while webhooks continue processing.
- [ ] **P11-12 FREE**: Change approved live catalogue after approval. Expected: fingerprint becomes stale and Checkout blocks until reapproval.
- [ ] **P11-13 FREE**: Run `npm run test:stripe-phase11` and `npm run test:stripe-phase11-ui` before any real-money test.

## Phase 12: Finance, Reconciliation, and Close

- [ ] **P12-01 FREE**: Open Admin -> Billing -> Finance. Expected: environment/date filters, KPI definitions, breakdowns, findings, trace, thresholds, exports, and close controls.
- [ ] **P12-02 STRIPE READ-ONLY**: Reconcile Stripe test mode. Expected: balance transactions synchronize without changing the credit ledger.
- [ ] **P12-03 FREE**: Compare gross sales, refunds, net sales, Stripe fees, net cash, provider cost, and margin to source records.
- [ ] **P12-04 FREE**: Verify subscription/top-up revenue, credit movements, liabilities, MRR, active/new/canceled subscriptions, and churn.
- [ ] **P12-05 FREE**: Verify non-USD settlement normalization. Expected: source/order values report in USD while MYR settlement amount, exchange rate, fee, and net remain visible for audit.
- [ ] **P12-06 FREE/ISOLATED**: Create controlled missing-grant and duplicate-grant fixtures locally. Expected: findings appear and reconciliation does not repair/delete ledger rows automatically.
- [ ] **P12-07 FREE**: Verify refund-without-reversal, subscription mismatch, failed webhook, negative balance, margin, liability, and high-spend alerts with isolated fixtures.
- [ ] **P12-08 FREE**: Resolve, ignore, and reopen a finding with notes. Expected: actor/time/note are audited.
- [ ] **P12-09 FREE**: Export summary, transactions, ledger, users, and findings CSV. Expected: filters apply and export action is logged.
- [ ] **P12-10 FREE**: Close a daily/monthly period. Expected: hash-protected snapshot is created; duplicate close is rejected.
- [ ] **P12-11 FREE**: Test finance permissions. Expected: view, reconcile, export, close, and resolve rights are independent.
- [ ] **P12-12 STRIPE READ-ONLY**: Trigger automation cron after 20+ hours. Expected: connected modes reconcile once; reconciliation failure does not fail automation jobs.
- [ ] **P12-13 FREE**: Run `npm run test:stripe-phase12` and `npm run test:stripe-phase12-ui`.

## Extended Phase-by-Phase Verification

The tests below supplement the primary acceptance cases above. P0 cases are mandatory for production promotion.

### Phase 1 Extended: Ledger, Quotes, and Data Migration

- [ ] **P1-11 P0 FREE**: Normalize a legacy workspace with only `workspace.credits`. Expected: one deterministic opening-balance row is created and repeated normalization does not create another.
- [ ] **P1-12 P0 FREE**: Recalculate balance from ledger after deliberately changing the cached workspace balance in an isolated fixture. Expected: ledger wins and cached balance is corrected.
- [ ] **P1-13 P0 FREE**: Test grant expiry at one second before, exactly at, and one second after expiry. Expected: boundary behavior is consistent and documented in UTC.
- [ ] **P1-14 P0 FREE**: Combine grant, purchase, bonus, usage, reserve, release, refund, and adjustment rows. Expected: available/reserved/lifetime totals match an independent calculation.
- [ ] **P1-15 P0 FREE**: Use a fractional provider cost that produces fractional credits. Expected: final charge always rounds up to the next whole credit.
- [ ] **P1-16 P1 FREE**: Submit zero, negative, `NaN`, excessively large, and missing quote inputs. Expected: validation rejects invalid inputs without creating state.
- [ ] **P1-17 P0 FREE**: Quote an inactive rate card or inactive provider mapping. Expected: paid action cannot silently fall back to a free rate.
- [ ] **P1-18 P1 FREE**: Quote an unknown UI model ID. Expected: explicit configuration error identifies the missing mapping.
- [ ] **P1-19 P0 FREE**: Submit two simultaneous admin adjustments. Expected: both append once and final balance equals the serialized sum.
- [ ] **P1-20 P0 FREE**: Standard user calls admin adjustment API. Expected: HTTP 403 and no ledger/activity mutation.
- [ ] **P1-21 P0 FREE**: Admin attempts adjustment for a user outside permitted scope. Expected: cross-workspace access is blocked or explicitly owner-only.
- [ ] **P1-22 P1 FREE**: Restart app and deploy a new revision. Expected: ledger, rates, mappings, plans, packages, and balances persist.
- [ ] **P1-23 P1 FREE**: Confirm quote response excludes internal secrets and contains rate-card/mapping identifiers needed for audit.
- [ ] **P1-24 P1 FREE**: Verify every default model/actor mapping resolves to exactly one active rate card or an intentional composite quote.

### Phase 2 Extended: Quote UX and State Transitions

- [ ] **P2-09 P1 FREE**: Rapidly change model/duration several times. Expected: stale quote responses never overwrite the newest selection.
- [ ] **P2-10 P1 FREE**: Simulate quote endpoint timeout/failure. Expected: Generate is blocked or clearly marked unavailable; no guessed price is displayed.
- [ ] **P2-11 P0 FREE**: Set balance exactly equal to quote. Expected: action remains allowed and settles to zero without becoming negative.
- [ ] **P2-12 P0 FREE**: Set balance one credit below quote. Expected: frontend and backend both block the action.
- [ ] **P2-13 P1 FREE**: Double-click a paid button. Expected: one visual pending state and one backend action.
- [ ] **P2-14 P1 FREE**: Start action and navigate to another tab. Expected: reserved/running state remains visible when returning.
- [ ] **P2-15 P1 FREE**: Complete/fail an asynchronous action. Expected: displayed balance and label refresh without a full page reload.
- [ ] **P2-16 P2 FREE**: Test credit labels with 1, 999, 1,000, and 1,000,000+ credits. Expected: readable formatting without truncation.
- [ ] **P2-17 P1 FREE**: Test buttons at 390px mobile width and keyboard-only navigation. Expected: label, cost, tooltip/helper, focus, and disabled state are understandable.
- [ ] **P2-18 P1 FREE**: Update a rate card in Admin while user page is open. Expected: next relevant form change/action retrieves the updated quote.
- [ ] **P2-19 P0 FREE**: Tamper with displayed credit value in browser devtools/request body. Expected: backend ignores client price and recalculates.

### Phase 3 Extended: Reservation Integrity and Recovery

- [ ] **P3-09 P0 FREE**: Two concurrent actions compete for a balance sufficient for only one. Expected: one reservation succeeds and one is rejected atomically.
- [ ] **P3-10 P0 FREE**: Retry reservation with the same idempotency/related reference. Expected: no duplicate active reserve.
- [ ] **P3-11 P0 FREE**: Deliver settlement twice. Expected: one usage row and one final charge.
- [ ] **P3-12 P0 FREE**: Deliver release twice. Expected: balance restores once and no duplicate release affects totals.
- [ ] **P3-13 P0 FREE**: Settle after release and release after settle. Expected: invalid transition is ignored/rejected and balance stays correct.
- [ ] **P3-14 P0 FREE**: Crash/restart after reservation but before provider call. Expected: action can be safely resumed or stale reservation is recoverable with audit evidence.
- [ ] **P3-15 P0 FREE**: Crash/restart after provider acceptance but before local settlement. Expected: provider task ID permits idempotent recovery without a second provider call.
- [ ] **P3-16 P1 FREE**: Variable-cost action reserves maximum and settles below maximum. Expected: unused credits return immediately.
- [ ] **P3-17 P0 FREE**: Provider actual cost exceeds reserved maximum. Expected: policy blocks/caps/manual-reviews without creating a negative balance.
- [ ] **P3-18 P0 FREE**: Directly invoke every paid backend action without quote/reservation setup. Expected: no route bypasses billing enforcement.
- [ ] **P3-19 P1 FREE**: Ensure failed reservations do not produce provider task IDs or outbound provider logs.
- [ ] **P3-20 P1 FREE**: Verify reservation, release, settlement, and provider logs share the same related action/task identifiers.
- [ ] **P3-21 P1 FREE**: Confirm released reservations do not count as usage, revenue, or active reserved credits in reports.
- [ ] **P3-22 P0 FREE**: Run balance invariant check across every workspace. Expected: no negative balances unless an explicitly supported migration exception exists.

### Phase 4 Extended: Models, Attachments, Polling, and Storage

- [ ] **P4-11 P0 FREE**: Select video content and attempt image/text model submission through API tampering. Expected: backend normalizes or rejects incompatible model/type.
- [ ] **P4-12 P0 FREE**: Select image/text content and attempt Seedance/VEO. Expected: incompatible generation cannot start or charge.
- [ ] **P4-13 P1 FREE**: Verify Seedance/VEO duration dropdown contains only provider-supported values and rounds imported duration to a valid option.
- [ ] **P4-14 P1 FREE**: Verify video aspect ratios exclude unsupported 1:1 and image ratios are limited to 1:1, 4:5, 16:9, and 9:16.
- [ ] **P4-15 PAID API**: Generate with saved Persona logo, avatar, product, and audio. Expected: selected references and roles reach provider payload/prompt and appear in logs.
- [ ] **P4-16 PAID API**: Generate with one-off uploaded references. Expected: uploads persist, thumbnails display, and only selected assets are used.
- [ ] **P4-17 P0 FREE**: Submit invalid/unreachable reference URL. Expected: clear failure/release or explicit generation without that optional reference; no hanging reservation.
- [ ] **P4-18 P1 FREE**: Click Generate with attachments. Expected: immediate My Contents redirect/pending row before uploads/provider work complete.
- [ ] **P4-19 P1 FREE**: Poll pending generation. Expected: progress advances without duplicate provider polling charges or duplicate assets.
- [ ] **P4-20 P0 FREE**: Return provider success with no output URL. Expected: status is Failed, never Done.
- [ ] **P4-21 P1 FREE**: Simulate provider URL download failure during GCS retention. Expected: retry/fallback is logged and user is not shown a false retained URL.
- [ ] **P4-22 P1 FREE**: Preview image/video/text in-app, then download. Expected: correct MIME type, filename, playback controls, and non-HTML media response.
- [ ] **P4-23 P0 FREE**: Redeploy while asset is generating. Expected: row/task survives and polling completes after deployment.
- [ ] **P4-24 P1 FREE**: Verify prompt logs include final enriched prompt, model, duration/dimension, and reference URLs, with secrets removed.
- [ ] **P4-25 P0 FREE**: Complete two tasks out of order. Expected: each provider result updates only its own asset/publish row and reservation.
- [ ] **P4-26 P1 FREE**: Verify Create Again preserves original asset/history and creates a distinct task, ledger row, and timestamp.

### Phase 5 Extended: Provider Selection, Cache Keys, and Partial Failure

- [ ] **P5-10 P1 PAID API**: Test each Research platform/content-type combination. Expected: correct Apify actor/input and only supported filter choices.
- [ ] **P5-11 P1 PAID API**: Search a multi-word keyword and normalized hashtag form. Expected: intended query variants are logged and relevant results are returned without hidden niche injection.
- [ ] **P5-12 P1 FREE**: Submit malformed/unsupported social URL. Expected: validation before Apify reservation where possible.
- [ ] **P5-13 P0 FREE**: Repeat same query with a different platform, content type, date, or minimum-view filter. Expected: cache keys do not return mismatched old results.
- [ ] **P5-14 P0 FREE**: Start identical scans concurrently. Expected: one paid run or clear independent runs; never duplicate charge for one shared result unintentionally.
- [ ] **P5-15 PAID API**: Apify returns zero results successfully. Expected: scan completes visibly and settles according to actual configured provider cost/results.
- [ ] **P5-16 FREE**: Simulate Apify HTTP 400, 402, 403, 429, and 5xx. Expected: actionable error, correct token fallback policy, and release/no false result.
- [ ] **P5-17 P1 FREE**: Verify scan history records actor/run/dataset IDs, filters, source, timestamps, and billing reservation/settlement.
- [ ] **P5-18 P1 PAID API**: Persona uses Facebook + LinkedIn URLs together. Expected: crawl outputs combine once, then GPT maps into current single Persona profile.
- [ ] **P5-19 P1 FREE**: One Persona URL succeeds and one fails. Expected: useful partial autofill, transparent warning, and component-level settlement.
- [ ] **P5-20 P0 FREE**: Rerun Persona autofill. Expected: current profile is updated/replaced, not duplicated into multiple profiles.
- [ ] **P5-21 P1 PAID API**: Social Audit multiple connected accounts. Expected: each account result maps to correct platform/handle and paid work is traceable.
- [ ] **P5-22 P1 FREE**: Upload-Post account unavailable/reauth required. Expected: clear account status and no unsupported audit charge.
- [ ] **P5-23 P0 FREE**: Verify one user's research/persona/audit history and media cannot be read by another user.

### Phase 6 Extended: Scheduling, Caps, and Publishing

- [ ] **P6-10 P0 FREE**: Test schedule around UTC/MYT day and month boundaries. Expected: due time and cap periods use documented timezone consistently.
- [ ] **P6-11 P0 FREE**: Trigger two scheduler instances simultaneously. Expected: each watcher/job is claimed once.
- [ ] **P6-12 P0 FREE**: Restart during crawl, generation, and publish stages. Expected: workflow resumes/idempotently fails without duplicate provider spend.
- [ ] **P6-13 P0 FREE**: Two watchers share one user cap. Expected: combined spend cannot exceed daily/monthly cap through race conditions.
- [ ] **P6-14 P0 FREE**: Set balance/cap exactly equal to maximum run quote. Expected: run allowed; one credit below is skipped.
- [ ] **P6-15 P1 FREE**: Verify daily/monthly counters reset only at correct boundary and historical usage remains.
- [ ] **P6-16 P1 FREE**: Disabled/paused watcher reaches due time. Expected: scheduler does not crawl, generate, publish, or reserve.
- [ ] **P6-17 PAID API**: Source Watcher selects best result. Expected: chosen source metadata, ranking reason, and media carry into generated asset.
- [ ] **P6-18 P0 FREE**: Generation fails after successful crawl. Expected: crawl charge remains, generation reservation follows policy, and no publish occurs.
- [ ] **P6-19 P0 FREE**: Publish fails after successful generation. Expected: generated asset remains, publish status/error is retryable, prior charges are not duplicated.
- [ ] **P6-20 P1 FREE**: Connected social account is removed before publish. Expected: clear failure and no post to fallback/unintended account.
- [ ] **P6-21 PAID API**: Select Persona vs uploaded logo/avatar/product/audio. Expected: correct references persist on automation and reach generation.
- [ ] **P6-22 P1 FREE**: Verify low-balance skip/pause notification appears to user and in logs without repeated notification spam.
- [ ] **P6-23 P0 FREE**: Ensure scheduled reconciliation added in Phase 12 cannot make a successful automation run fail.

### Phase 7 Extended: User Billing Accuracy and Privacy

- [ ] **P7-09 P0 FREE**: Compare every displayed total against ledger aggregation for the same user/workspace.
- [ ] **P7-10 P0 FREE**: Log in as another user. Expected: no balances, orders, subscriptions, ledger descriptions, or payment IDs leak across users.
- [ ] **P7-11 P0 FREE**: Inspect `/api/app` billing payload. Expected: no API keys, webhook secrets, raw provider payloads, password hashes, or other users' data.
- [ ] **P7-12 P1 FREE**: Verify active reservation appears separately and available balance is reduced until settlement/release.
- [ ] **P7-13 P1 FREE**: Verify expired credits and refund reversals appear with understandable labels and timestamps.
- [ ] **P7-14 P1 FREE**: Test long usage/payment history. Expected: stable ordering, filters, and acceptable load time.
- [ ] **P7-15 P1 FREE**: Complete Stripe test Checkout in another tab and return. Expected: balance/payment history refreshes after webhook without duplicate purchase.
- [ ] **P7-16 P1 FREE**: Open Customer Portal with/without Stripe customer. Expected: valid portal or actionable setup message.
- [ ] **P7-17 P1 FREE**: Disable a plan/package in Admin. Expected: it disappears from user purchase options without affecting history.
- [ ] **P7-18 P2 FREE**: Verify USD and credit formatting is consistent across small, large, negative/refund, and zero values.
- [ ] **P7-19 P1 FREE**: Disabled user attempts Billing APIs with old session. Expected: unauthorized and no data returned.

### Phase 8 Extended: Admin Validation, Secrets, and Permissions

- [ ] **P8-10 P0 FREE**: Submit invalid plan/package values: negative price/credits, bonus over policy, zero expiry, huge limits. Expected: server validation or documented normalization.
- [ ] **P8-11 P0 FREE**: Submit invalid rate-card unit/action/provider combination. Expected: rejected without breaking existing quotes.
- [ ] **P8-12 P0 FREE**: Remove/disable mapping used by active feature. Expected: feature fails closed with configuration error, never free.
- [ ] **P8-13 P0 FREE**: Read-only support admin attempts PATCH/POST operations. Expected: HTTP 403 and no audit/state mutation.
- [ ] **P8-14 P0 FREE**: Test each granular billing/Stripe/finance permission independently.
- [ ] **P8-15 P0 FREE**: Replace an API key. Expected: raw value accepted only on write, encrypted/secret storage updated, and subsequent reads return status only.
- [ ] **P8-16 P0 FREE**: Search logs/API responses/browser source for submitted secret. Expected: no raw key appears.
- [ ] **P8-17 P1 FREE**: Two admins edit same rate/plan concurrently. Expected: final behavior is deterministic and both actions are audited.
- [ ] **P8-18 P1 FREE**: Verify inactive offers cannot start new Checkout but remain visible in historical orders/revisions.
- [ ] **P8-19 P0 FREE**: Delete/disable user with active balance/subscription. Expected: explicit safe behavior, no orphaned ledger/history, and no unauthorized Checkout.
- [ ] **P8-20 P1 FREE**: Verify every admin mutation creates activity/debug audit with actor, timestamp, operation, and sanitized values.
- [ ] **P8-21 P1 FREE**: Deploy/restart after settings edits. Expected: settings and role permissions persist.
- [ ] **P8-22 P1 FREE**: Verify owner/super-admin receives newly introduced permissions after schema normalization; configurable roles retain saved choices.

### Phase 9 Extended: Pricing Governance and Quote Propagation

- [ ] **P9-08 P1 FREE**: Provider pricing endpoint is unavailable. Expected: failed sync run is recorded and active rates remain unchanged.
- [ ] **P9-09 P0 FREE**: Provider returns malformed/negative/zero/unsupported pricing. Expected: manual review, never automatic application.
- [ ] **P9-10 P1 FREE**: Provider cost rises/falls substantially. Expected: old/new cost and percentage are correct and clearly flagged.
- [ ] **P9-11 P1 FREE**: Run sync repeatedly with unchanged data. Expected: no duplicate pending alert flood.
- [ ] **P9-12 P0 FREE**: Approve same alert twice. Expected: rate changes once and decision remains idempotent.
- [ ] **P9-13 P1 FREE**: Reject an alert then sync again with same provider price. Expected: behavior follows documented re-alert/manual policy.
- [ ] **P9-14 P0 FREE**: Approve price change and immediately quote every affected UI action. Expected: backend and frontend use new rate without code deployment.
- [ ] **P9-15 P0 FREE**: Existing ledger/order/close history remains unchanged after rate update.
- [ ] **P9-16 P1 FREE**: Actor metadata has pricing model unsupported by current units. Expected: `manual_required` with useful reason.
- [ ] **P9-17 P0 FREE**: User without pricing-management permission attempts sync/approve. Expected: HTTP 403.
- [ ] **P9-18 P1 FREE**: Verify sync logs contain source/time/model but not provider credentials.

### Phase 10 Extended: Stripe Test Payment Lifecycle

- [ ] **P10-10 P0 STRIPE TEST**: Cancel Checkout before payment. Expected: no credit grant; order remains pending/expired appropriately.
- [ ] **P10-11 P0 FREE**: Change plan/package after Checkout session creation. Expected: webhook grants immutable order/revision amount and credits.
- [ ] **P10-12 P0 STRIPE TEST**: Open two Checkout sessions and pay only one. Expected: one paid order/grant; unpaid order never grants.
- [ ] **P10-13 P0 FREE**: Deliver invoice/subscription events out of order. Expected: final subscription state is consistent and credits grant once.
- [ ] **P10-14 P0 FREE**: Deliver test event to live webhook and live event to test webhook. Expected: rejected/ignored with no state mutation.
- [ ] **P10-15 P0 FREE**: Webhook metadata is missing user/order/revision. Expected: failed/ignored diagnostic event; no guessed recipient.
- [ ] **P10-16 P0 FREE**: Stripe customer ID belongs to another mode/user. Expected: no cross-user grant.
- [ ] **P10-17 P0 STRIPE TEST**: Apply two partial refunds then final refund. Expected: cumulative credit reversal never exceeds original grant.
- [ ] **P10-18 P0 FREE**: Replay refund event. Expected: no duplicate reversal.
- [ ] **P10-19 P0 FREE**: Verify refund ledger status still reduces available balance and records negative proportional USD value.
- [ ] **P10-20 P1 STRIPE TEST**: Subscription renews for a second invoice. Expected: one new period grant tied to new invoice ID.
- [ ] **P10-21 P0 STRIPE TEST**: Payment fails then succeeds. Expected: no credits on failure; one grant after paid invoice.
- [ ] **P10-22 P1 FREE**: Disable Checkout kill switch after sessions exist. Expected: new sessions blocked while signed webhooks for old sessions continue.
- [ ] **P10-23 P0 FREE**: Inspect Checkout/Portal APIs unauthenticated and as disabled user. Expected: 401/403.
- [ ] **P10-24 P1 FREE**: Verify order/event/subscription records retain IDs/status/errors but no card/payment-method details.

### Phase 10.5 Extended: Stripe Connection and Catalogue Integrity

- [ ] **P10.5-09 P0 FREE**: Enter test key in live slot or live key in test slot. Expected: mode validation rejects it.
- [ ] **P10.5-10 P0 FREE**: Enter invalid/revoked/restricted key lacking required scope. Expected: clear validation error and previous working connection remains.
- [ ] **P10.5-11 P0 FREE**: Webhook endpoint creation fails after account validation. Expected: connection reports error and Checkout cannot be enabled.
- [ ] **P10.5-12 P0 STRIPE TEST**: Catalogue sync partially fails. Expected: per-item errors, no false all-synced status, and rerun completes missing items idempotently.
- [ ] **P10.5-13 P0 STRIPE TEST**: Change an offer and sync. Expected: new immutable revision/price; previous order/revision remains unchanged.
- [ ] **P10.5-14 P1 STRIPE TEST**: Re-run sync with no changes. Expected: no duplicate active products/prices/revisions.
- [ ] **P10.5-15 P0 FREE**: Enable Checkout before account/webhook/catalogue readiness. Expected: server blocks.
- [ ] **P10.5-16 P0 FREE**: Replace connection credentials. Expected: mode-specific customer/order/history retained and new validation timestamp recorded.
- [ ] **P10.5-17 P0 FREE**: Disconnect one mode. Expected: other mode remains connected and unaffected.
- [ ] **P10.5-18 P1 FREE**: Verify webhook URL exactly targets `/test` or `/live` API endpoint for that mode.
- [ ] **P10.5-19 P0 FREE**: Test restricted Stripe keys with only documented required scopes. Expected: supported operations pass; missing scope fails safely.
- [ ] **P10.5-20 P1 FREE**: Confirm catalogue/order/revision/customer IDs remain available after disconnect for finance audit.

### Phase 11 Extended: Live Gates, Rollout, and Rollback

- [ ] **P11-14 P0 FREE**: Approve readiness, then change a readiness answer/evidence. Expected: approval becomes stale or requires reapproval.
- [ ] **P11-15 P0 FREE**: Test every typed confirmation with wrong text/case/spacing. Expected: destructive/live operation remains blocked.
- [ ] **P11-16 P0 FREE**: Connect wrong account/mode or account with charges disabled. Expected: preflight/connect blocks launch.
- [ ] **P11-17 P0 FREE**: Approve catalogue, then change price/credits/mapping. Expected: fingerprint mismatch blocks Checkout.
- [ ] **P11-18 P0 FREE**: Owner-only rollout with admin/support/standard users. Expected: only owner/super-admin qualifies.
- [ ] **P11-19 P0 FREE**: Internal rollout. Expected: only documented internal roles qualify.
- [ ] **P11-20 P0 FREE**: Add/remove allowlisted user while sessions are attempted. Expected: new access follows latest allowlist immediately.
- [ ] **P11-21 P0 FREE**: All-verified rollout with unverified and disabled users. Expected: both remain blocked.
- [ ] **P11-22 P0 FREE**: Emergency stop during an existing Checkout. Expected: no new sessions; completed old payment webhook still reconciles.
- [ ] **P11-23 P0 FREE**: Restart/deploy while emergency stop is active. Expected: stop persists.
- [ ] **P11-24 P0 FREE**: Mode-aware duplicate event IDs/refunds. Expected: test event cannot suppress or match live event and vice versa.
- [ ] **P11-25 P0 FREE**: Attempt launch report approval with missing orders/ledger/checks. Expected: blocked.
- [ ] **P11-26 P0 FREE**: Approve report after top-up was paid then refunded. Expected: accepted only with paid timestamp and valid refund evidence.
- [ ] **P11-27 P0 FREE**: Search launch report/logs for secrets/card data. Expected: only redacted IDs and evidence.
- [ ] **P11-28 P0 FREE**: Roll back live rollout to disabled. Expected: Checkout stops, webhooks/history remain, test mode remains available.
- [ ] **P11-29 P1 FREE**: Verify rollout, readiness, catalogue approval, smoke report, and emergency actions each record actor/time.

### Phase 12 Extended: Accounting, Reconciliation, Alerts, and Close

- [ ] **P12-14 P0 FREE**: Test date filter start/end boundaries and MYT/UTC conversion. Expected: each transaction/order/ledger row appears in exactly one intended period.
- [ ] **P12-15 P0 FREE**: Switch test/live environment. Expected: transactions, orders, subscriptions, runs, alerts, and close reports never mix modes.
- [ ] **P12-16 P0 FREE**: Reconcile with no Stripe transactions. Expected: completed run, zero transactions, and clearly labeled local-ledger fallback.
- [ ] **P12-17 P0 STRIPE READ-ONLY**: Reconcile same range twice. Expected: balance transactions upsert by Stripe ID and do not duplicate.
- [ ] **P12-18 P0 STRIPE READ-ONLY**: Reconcile non-USD settlement. Expected: source charge/refund USD controls sales matching; settlement currency/amount/rate remain auditable.
- [ ] **P12-19 P0 FREE**: Independently calculate Stripe fee conversion from settlement fee/exchange rate. Expected: dashboard USD fee matches within cent rounding.
- [ ] **P12-20 P0 FREE**: Compare gross sales with paid and fully refunded orders. Expected: gross retains original sale; refund and net sales show reversal separately.
- [ ] **P12-21 P0 FREE**: Compare provider costs to succeeded usage ledger only. Expected: failed/released reserves do not inflate provider cost.
- [ ] **P12-22 P0 FREE**: Validate gross margin = net sales - provider cost and margin % handles zero/negative net sales without `NaN`/infinity.
- [ ] **P12-23 P0 FREE**: Validate face-value liability from current unused credits and provider-cost liability from configured markup.
- [ ] **P12-24 P0 FREE**: Validate expired credits are reported in the expiry period and excluded from current liability.
- [ ] **P12-25 P0 FREE**: Validate MRR from active/trialing plans and churn/new/canceled counts for period boundaries.
- [ ] **P12-26 P0 ISOLATED**: Detect payment without credits, credits without payment, duplicate credit, amount/currency mismatch, and refund without reversal.
- [ ] **P12-27 P1 ISOLATED**: Detect subscription mismatch, webhook failure, negative balance, low margin, high liability, and high user spend.
- [ ] **P12-28 P0 FREE**: Fix a controlled discrepancy then reconcile. Expected: open finding auto-resolves with system resolution note.
- [ ] **P12-29 P1 FREE**: Ignore a finding then reconcile while condition remains. Expected: ignored decision remains unless explicitly reopened.
- [ ] **P12-30 P0 FREE**: Reconciliation source expansion fails due restricted Stripe scope. Expected: accounting transaction remains stored; missing trace enrichment is transparent.
- [ ] **P12-31 P0 FREE**: Reconciliation network/API failure. Expected: failed run persists, no ledger/order mutation, prior report data remains available.
- [ ] **P12-32 P0 FREE**: Export each dataset under filters. Expected: CSV amounts/IDs match UI/API and spreadsheet quoting handles commas/quotes safely.
- [ ] **P12-33 P0 FREE**: User without export/close/reconcile/resolve permission calls endpoint directly. Expected: HTTP 403 and no audit/state mutation.
- [ ] **P12-34 P0 FREE**: Create close report, then change rates/orders/alerts. Expected: prior close metrics/hash remain immutable.
- [ ] **P12-35 P0 FREE**: Attempt identical close again. Expected: HTTP 409 and original close unchanged.
- [ ] **P12-36 P0 FREE**: Verify close hash by recomputing from stored snapshot fields. Expected: exact match.
- [ ] **P12-37 P1 FREE**: Scheduler runs repeatedly within 20 hours. Expected: no additional scheduled reconciliation; after interval, one new run per connected mode.
- [ ] **P12-38 P0 FREE**: Scheduled reconciliation fails while automation work succeeds. Expected: automation endpoint reports finance failure separately and retains successful automation result.
- [ ] **P12-39 P1 FREE**: Test Finance dashboard with large transaction/ledger/alert sets. Expected: filters/tables remain responsive and page has no mobile overflow.
- [ ] **P12-40 P0 FREE**: Verify Finance API and exports never expose Stripe keys, webhook secrets, session cookies, or card/payment-method data.

## Financial Calculation Fixtures

Validate these against `/api/billing/quote`, reservations, settlements, and reports. If Admin rates are changed, record the actual configured rate and recompute expected values using the same formula.

| Fixture | Provider cost | Markup | Expected user charge | Expected credits at 1,000/USD |
|---|---:|---:|---:|---:|
| VEO Fast 720p | $0.30/action | 2x | $0.60 | 600 |
| Seedance 2.0, 1 second | $0.205 | 2x | $0.41 | 410 |
| Seedance 2.0, 8 seconds | $1.64 | 2x | $3.28 | 3,280 |
| GPT Image 2, 1K | $0.03/image | 2x | $0.06 | 60 |
| GPT Image 2, 2K | $0.05/image | 2x | $0.10 | 100 |
| GPT Image 2, 4K | $0.08/image | 2x | $0.16 | 160 |
| Nano Banana Pro, 1/2K | $0.09/image | 2x | $0.18 | 180 |
| Nano Banana Pro, 4K | $0.12/image | 2x | $0.24 | 240 |
| Fractional rounding | $0.0001/action | 2x | $0.0002 | 1, rounded up |

Additional financial invariants:

- [ ] Sum of available plus active reserved credits equals spendable grants minus settled usage under the documented expiry/refund rules.
- [ ] A released reservation contributes zero usage and zero permanent balance change.
- [ ] A settled reservation contributes one usage debit and cannot settle again.
- [ ] A full refund removes no more than the original granted credits and USD value.
- [ ] Multiple partial refunds cumulatively equal, but never exceed, the final Stripe refunded proportion.
- [ ] Gross sales retain paid order value; refunds are separate; net sales equal gross minus refunds.
- [ ] Net cash equals net sales minus USD-normalized Stripe fees under the current definition.
- [ ] Gross margin equals net sales minus succeeded provider usage cost.
- [ ] Existing ledger, order revision, and finance close values do not change when current rates/plans/packages change.

## Cross-Phase Security and Isolation

- [ ] **SEC-01 P0**: Every protected API returns 401 without a valid session.
- [ ] **SEC-02 P0**: Every admin/finance/Stripe mutation returns 403 without its specific permission.
- [ ] **SEC-03 P0**: Disabled users cannot reuse old sessions for billing, Checkout, Portal, or provider actions.
- [ ] **SEC-04 P0**: Unverified users cannot enter rollout states requiring verification.
- [ ] **SEC-05 P0**: User/workspace IDs in request bodies cannot be changed to access another user's records or credits.
- [ ] **SEC-06 P0**: API keys and webhook secrets are write-only and absent from HTML, API payloads, logs, exports, and screenshots.
- [ ] **SEC-07 P0**: Public-upload URLs are unguessable and expose only intended retained media.
- [ ] **SEC-08 P1**: Invalid JSON, oversized payloads, and unexpected fields fail safely without stack traces or state corruption.
- [ ] **SEC-09 P0**: Stripe webhook verification uses exact raw body and mode-specific signing secret.
- [ ] **SEC-10 P1**: CSV values beginning with spreadsheet formulas are neutralized or documented as an export risk before production use.

## Cross-Phase Reliability and Performance

- [ ] **REL-01 P0**: Duplicate clicks, requests, webhooks, polls, and scheduler invocations do not duplicate provider spend or credits.
- [ ] **REL-02 P0**: App restart/deployment preserves users, balances, ledger, orders, subscriptions, automation, generated media, and finance history.
- [ ] **REL-03 P0**: Database/storage failure never falls back to silently granting free paid-provider access.
- [ ] **REL-04 P1**: Provider timeout has bounded request duration and visible retry/recovery state.
- [ ] **REL-05 P1**: Billing and Finance pages load acceptably with at least 1,000 ledger rows and 250 displayed trace rows.
- [ ] **REL-06 P1**: Mobile pages have no document-level horizontal overflow; wide tables scroll inside their container.
- [ ] **REL-07 P1**: Long model IDs, emails, descriptions, and Stripe references do not overlap controls.
- [ ] **REL-08 P1**: Browser console has no errors during each primary workflow.
- [ ] **REL-09 P0**: Backup and restore reproduce the same balance, order, subscription, and close-report hashes.
- [ ] **REL-10 P1**: Health endpoints remain HTTP 200 after deployment and during normal reconciliation/provider failures.

## Mandatory Regression Suite

- [ ] `npm run build`
- [ ] `npm run test:stripe-phase10.5`
- [ ] `npm run test:stripe-phase10.5-ui`
- [ ] `npm run test:stripe-phase11`
- [ ] `npm run test:stripe-phase11-ui`
- [ ] `npm run test:stripe-phase12`
- [ ] `npm run test:stripe-phase12-ui`
- [ ] Remote desktop browser smoke: frontend, Billing tab, Admin Billing, Finance, Checkout guardrails.
- [ ] Remote mobile browser smoke at approximately 390 x 844: no page overflow or inaccessible actions.
- [ ] Verify persisted users, balances, ledger, orders, subscriptions, generated history, and API keys survived deployment.

## Promotion Gate

Promote staging to production only when:

- [ ] Every required test is Pass or has an explicitly accepted exception.
- [ ] No unresolved critical billing/reconciliation findings remain.
- [ ] Credit balances reconcile to the append-only ledger.
- [ ] Stripe test catalogue and webhooks are healthy.
- [ ] Live rollout remains disabled unless Phase 11 live acceptance is approved.
- [ ] A backup and rollback commit/revision are recorded.
