# ContentAgent Billing: Phase 1-12 Test Checklist

Use this checklist on staging before promoting billing changes to production.

## Test Labels

- **FREE**: local/app/Stripe test-mode validation; no Kie or Apify usage.
- **PAID API**: consumes Kie, Apify, or another provider balance.
- **LIVE MONEY**: creates a real Stripe payment or refund. Run only with explicit approval.

## Test Setup

- [ ] Record the deployment commit, GitHub Actions run, deployment time, and staging URLs.
- [ ] Confirm frontend, Admin, and API health endpoints return HTTP 200.
- [ ] Use a dedicated verified staging user and record its starting credit balance.
- [ ] Keep Stripe in test mode except for the explicitly approved Phase 11 live smoke test.
- [ ] Take a database backup before destructive, refund, discrepancy, or close-period tests.
- [ ] Record each test as `Pass`, `Fail`, `Blocked`, or `Not run`, with evidence and notes.

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
