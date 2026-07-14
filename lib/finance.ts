import crypto from "crypto";
import { calculateCreditBalance } from "./billing";
import { stripeRequestForMode, stripeTimestampToIso } from "./stripeBilling";
import { id, mutateDb, readDb } from "./store";
import type {
  BillingFinanceCloseReport,
  BillingFinanceMetrics,
  BillingReconciliationAlert,
  BillingStripeBalanceTransaction,
  Database,
  StripeMode
} from "./types";

export type FinanceFilters = {
  from: string;
  to: string;
  mode: StripeMode;
  userId?: string;
  module?: string;
  provider?: string;
  query?: string;
};

export const financeMetricDefinitions = [
  ["Gross sales", "Paid subscription and credit-package orders before refunds."],
  ["Refunds", "Stripe refunds synchronized from balance transactions, with credit-ledger fallback."],
  ["Net sales", "Gross sales less refunds."],
  ["Stripe fees", "Stripe fees reported by synchronized balance transactions."],
  ["Net cash", "Net sales less Stripe fees; payouts are excluded because they are transfers."],
  ["Provider cost", "Recorded API provider cost for usage during the period."],
  ["Gross margin", "Net sales less provider cost."],
  ["Credit liability", "Current unused credits at face value and estimated provider cost."],
  ["MRR", "Current monthly plan value for active or trialing subscriptions."],
] as const;

export function normalizeFinanceFilters(input: Partial<FinanceFilters>): FinanceFilters {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 29 * 86400_000);
  return {
    from: validDate(input.from) || startOfDay(defaultFrom).toISOString(),
    to: validDate(input.to) || endOfDay(now).toISOString(),
    mode: input.mode === "live" ? "live" : "test",
    userId: clean(input.userId),
    module: clean(input.module),
    provider: clean(input.provider),
    query: clean(input.query).toLowerCase()
  };
}

export function buildFinanceReport(db: Database, rawFilters: Partial<FinanceFilters>) {
  const filters = normalizeFinanceFilters(rawFilters);
  const fromMs = new Date(filters.from).getTime();
  const toMs = new Date(filters.to).getTime();
  const inRange = (value?: string) => Boolean(value) && new Date(String(value)).getTime() >= fromMs && new Date(String(value)).getTime() <= toMs;
  const orders = db.billingCheckoutOrders.filter((order) => order.mode === filters.mode && Boolean(order.paidAt) && inRange(order.paidAt));
  const ledger = db.billingLedger.filter((entry) => {
    if (!inRange(entry.createdAt)) return false;
    if (filters.userId && entry.userId !== filters.userId) return false;
    if (filters.module && entry.module !== filters.module) return false;
    if (filters.provider && entry.provider !== filters.provider) return false;
    if (entry.provider === "stripe" && String(entry.metadata?.stripeMode || "test") !== filters.mode) return false;
    if (filters.query && !`${entry.description} ${entry.action} ${entry.relatedId || ""}`.toLowerCase().includes(filters.query)) return false;
    return true;
  });
  const transactions = db.billingStripeBalanceTransactions.filter((item) => item.mode === filters.mode && inRange(item.createdAt));
  const cashTransactions = transactions.filter((item) => !["payout", "payout_cancel", "payout_failure"].includes(item.type));
  const refundTransactions = cashTransactions.filter((item) => item.amountUsd < 0 && /refund|dispute|charge/.test(`${item.type} ${item.reportingCategory}`));
  const grossSalesUsd = sum(orders.map((item) => item.amountUsd));
  const ledgerRefunds = sum(ledger.filter((item) => item.type === "refund").map((item) => Math.abs(item.usdCost || 0)));
  const refundsUsd = transactions.length ? sum(refundTransactions.map((item) => Math.abs(item.amountUsd))) : ledgerRefunds;
  const stripeFeesUsd = sum(cashTransactions.filter((item) => item.amountUsd > 0 || item.feeUsd > 0).map((item) => Math.abs(item.feeUsd)));
  const netSalesUsd = round(grossSalesUsd - refundsUsd);
  const providerCostUsd = sum(ledger.filter((item) => item.type === "usage" && item.status === "succeeded").map((item) => Math.abs(item.usdCost || 0)));
  const grossMarginUsd = round(netSalesUsd - providerCostUsd);
  const activeSubscriptions = db.billingSubscriptions.filter((item) => item.stripeMode === filters.mode && ["active", "trialing"].includes(item.status));
  const mrrUsd = sum(activeSubscriptions.map((subscription) => db.billingPlans.find((plan) => plan.id === subscription.planId)?.priceUsd || 0));
  const canceledSubscriptions = db.billingSubscriptions.filter((item) => item.stripeMode === filters.mode && item.status === "canceled" && inRange(item.updatedAt)).length;
  const newSubscriptions = db.billingSubscriptions.filter((item) => item.stripeMode === filters.mode && inRange(item.createdAt)).length;
  const currentCredits = sum(db.workspaces.map((workspace) => Math.max(0, calculateCreditBalance(db, workspace.id).available)));
  const faceValueLiabilityUsd = round(currentCredits / Math.max(1, db.billingSettings.creditScale));
  const metrics: BillingFinanceMetrics = {
    grossSalesUsd,
    refundsUsd,
    netSalesUsd,
    stripeFeesUsd,
    netCashUsd: round(netSalesUsd - stripeFeesUsd),
    subscriptionRevenueUsd: sum(orders.filter((item) => item.itemKind === "plan").map((item) => item.amountUsd)),
    topUpRevenueUsd: sum(orders.filter((item) => item.itemKind === "package").map((item) => item.amountUsd)),
    providerCostUsd,
    grossMarginUsd,
    grossMarginPercent: netSalesUsd > 0 ? round(grossMarginUsd / netSalesUsd * 100) : 0,
    creditsSold: sum(ledger.filter((item) => ["purchase", "subscription_grant"].includes(item.type)).map((item) => Math.max(0, item.credits))),
    creditsGranted: sum(ledger.filter((item) => ["purchase", "subscription_grant", "bonus"].includes(item.type)).map((item) => Math.max(0, item.credits))),
    creditsConsumed: sum(ledger.filter((item) => item.type === "usage").map((item) => Math.abs(item.credits))),
    creditsExpired: sum(db.billingLedger.filter((item) => item.expiresAt && inRange(item.expiresAt) && ["purchase", "subscription_grant", "bonus", "admin_adjustment"].includes(item.type)).map((item) => Math.max(0, item.credits))),
    creditsRefunded: sum(ledger.filter((item) => item.type === "refund").map((item) => Math.abs(item.credits))),
    creditsAdjusted: sum(ledger.filter((item) => item.type === "admin_adjustment").map((item) => item.credits)),
    faceValueLiabilityUsd,
    providerCostLiabilityUsd: round(faceValueLiabilityUsd / Math.max(1, db.billingSettings.defaultMarkupMultiplier)),
    mrrUsd,
    activeSubscriptions: activeSubscriptions.length,
    newSubscriptions,
    canceledSubscriptions,
    churnRatePercent: activeSubscriptions.length + canceledSubscriptions > 0 ? round(canceledSubscriptions / (activeSubscriptions.length + canceledSubscriptions) * 100) : 0
  };
  const alerts = db.billingReconciliationAlerts.filter((item) => item.mode === filters.mode).sort((a, b) => new Date(b.lastDetectedAt).getTime() - new Date(a.lastDetectedAt).getTime());
  const users = db.users.map((user) => {
    const entries = ledger.filter((entry) => entry.userId === user.id);
    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      creditsUsed: sum(entries.filter((entry) => entry.type === "usage").map((entry) => Math.abs(entry.credits))),
      providerCostUsd: sum(entries.filter((entry) => entry.type === "usage").map((entry) => Math.abs(entry.usdCost || 0))),
      creditsPurchased: sum(entries.filter((entry) => ["purchase", "subscription_grant"].includes(entry.type)).map((entry) => Math.max(0, entry.credits)))
    };
  }).filter((item) => item.creditsUsed || item.creditsPurchased);
  return {
    filters,
    metrics,
    dataSource: transactions.length ? "stripe_balance_transactions" : "local_ledger_fallback",
    metricDefinitions: financeMetricDefinitions,
    quality: {
      synchronizedTransactions: transactions.length,
      unresolvedAlerts: alerts.filter((item) => item.status === "open").length,
      lastReconciledAt: db.billingReconciliationRuns.filter((item) => item.mode === filters.mode && item.status === "completed").sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())[0]?.completedAt
    },
    revenueByType: [
      { label: "Subscriptions", amountUsd: metrics.subscriptionRevenueUsd },
      { label: "Credit top-ups", amountUsd: metrics.topUpRevenueUsd }
    ],
    costsByProvider: groupUsd(ledger.filter((item) => item.type === "usage"), (item) => item.provider),
    usageByModule: groupCredits(ledger.filter((item) => item.type === "usage"), (item) => item.module),
    users,
    transactions: transactions.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 250),
    ledger: ledger.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 250),
    orders: orders.slice().sort((a, b) => new Date(String(b.paidAt)).getTime() - new Date(String(a.paidAt)).getTime()).slice(0, 250),
    alerts,
    reconciliationRuns: db.billingReconciliationRuns.filter((item) => item.mode === filters.mode).sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()).slice(0, 25),
    closeReports: db.billingFinanceCloseReports.filter((item) => item.mode === filters.mode).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 50)
  };
}

export async function runStripeReconciliation(input: { mode: StripeMode; from: string; to: string; source: "manual" | "scheduled"; initiatedBy?: string }) {
  const filters = normalizeFinanceFilters(input);
  const startedAt = new Date().toISOString();
  try {
    const fetched = await fetchStripeBalanceTransactions(input.mode, filters.from, filters.to);
    return await mutateDb((db) => {
      for (const transaction of fetched) {
        const existing = db.billingStripeBalanceTransactions.find((item) => item.mode === transaction.mode && item.stripeBalanceTransactionId === transaction.stripeBalanceTransactionId);
        if (existing) Object.assign(existing, transaction);
        else db.billingStripeBalanceTransactions.push(transaction);
      }
      const detected = detectReconciliationAlerts(db, input.mode, filters.from, filters.to);
      upsertAlerts(db, input.mode, detected);
      const run = {
        id: id("recon"), mode: input.mode, source: input.source, status: "completed" as const,
        from: filters.from, to: filters.to, syncedTransactions: fetched.length,
        checkedRecords: db.billingCheckoutOrders.length + db.billingLedger.length + fetched.length,
        alertsDetected: detected.length, startedAt, completedAt: new Date().toISOString(), initiatedBy: input.initiatedBy
      };
      db.billingReconciliationRuns.push(run);
      return run;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe reconciliation failed.";
    await mutateDb((db) => db.billingReconciliationRuns.push({
      id: id("recon"), mode: input.mode, source: input.source, status: "failed", from: filters.from, to: filters.to,
      syncedTransactions: 0, checkedRecords: 0, alertsDetected: 0, startedAt, completedAt: new Date().toISOString(), initiatedBy: input.initiatedBy, error: message
    }));
    throw new Error(message);
  }
}

export async function runScheduledFinanceReconciliation() {
  const db = await readDb();
  const results: Array<{ mode: StripeMode; status: string; reason?: string }> = [];
  for (const mode of ["test", "live"] as const) {
    const connection = db.billingStripeConnections.find((item) => item.mode === mode);
    if (connection?.status !== "connected") continue;
    const last = db.billingReconciliationRuns.filter((item) => item.mode === mode && item.source === "scheduled" && item.status === "completed").sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())[0];
    if (last && Date.now() - new Date(last.completedAt).getTime() < 20 * 3600_000) continue;
    try {
      await runStripeReconciliation({ mode, from: new Date(Date.now() - 32 * 86400_000).toISOString(), to: new Date().toISOString(), source: "scheduled" });
      results.push({ mode, status: "completed" });
    } catch (error) {
      results.push({ mode, status: "failed", reason: error instanceof Error ? error.message : "Failed" });
    }
  }
  return results;
}

export function createFinanceClose(db: Database, input: { periodType: "daily" | "monthly"; mode: StripeMode; from: string; to: string; createdBy: string }) {
  const filters = normalizeFinanceFilters(input);
  const existing = db.billingFinanceCloseReports.find((item) => item.mode === input.mode && item.periodType === input.periodType && item.from === filters.from && item.to === filters.to);
  if (existing) throw new Error("This finance period is already closed. Close reports are immutable.");
  const report = buildFinanceReport(db, filters);
  const openAlerts = report.alerts.filter((item) => item.status === "open");
  const base = {
    id: id("close"), periodType: input.periodType, mode: input.mode, from: filters.from, to: filters.to,
    metrics: report.metrics, unresolvedAlertCount: openAlerts.length,
    unresolvedAlertValueUsd: sum(openAlerts.map((item) => Math.abs(item.amountUsd || 0))),
    transactionCount: report.transactions.length, ledgerEntryCount: report.ledger.length,
    createdAt: new Date().toISOString(), createdBy: input.createdBy
  };
  const close: BillingFinanceCloseReport = { ...base, hash: crypto.createHash("sha256").update(JSON.stringify(base)).digest("hex") };
  db.billingFinanceCloseReports.push(close);
  return close;
}

async function fetchStripeBalanceTransactions(mode: StripeMode, from: string, to: string) {
  const output: BillingStripeBalanceTransaction[] = [];
  let startingAfter = "";
  for (let page = 0; page < 5; page += 1) {
    const response = await stripeRequestForMode<{ data?: Record<string, unknown>[]; has_more?: boolean }>(mode, "GET", "/balance_transactions", {
      limit: 100,
      "created[gte]": Math.floor(new Date(from).getTime() / 1000),
      "created[lte]": Math.floor(new Date(to).getTime() / 1000),
      starting_after: startingAfter || undefined
    });
    const data = Array.isArray(response.data) ? response.data : [];
    for (const raw of data) output.push(await normalizeStripeTransaction(mode, raw));
    if (!response.has_more || !data.length) break;
    startingAfter = String(data[data.length - 1].id || "");
  }
  return output;
}

async function normalizeStripeTransaction(mode: StripeMode, raw: Record<string, unknown>): Promise<BillingStripeBalanceTransaction> {
  const sourceValue = raw.source;
  const sourceId = typeof sourceValue === "string" ? sourceValue : sourceValue && typeof sourceValue === "object" ? String((sourceValue as Record<string, unknown>).id || "") : "";
  let chargeId = sourceId.startsWith("ch_") ? sourceId : "";
  let refundId = sourceId.startsWith("re_") ? sourceId : "";
  let paymentIntentId = "";
  try {
    if (chargeId) {
      const charge = await stripeRequestForMode<Record<string, unknown>>(mode, "GET", `/charges/${encodeURIComponent(chargeId)}`);
      paymentIntentId = objectId(charge.payment_intent);
    } else if (refundId) {
      const refund = await stripeRequestForMode<Record<string, unknown>>(mode, "GET", `/refunds/${encodeURIComponent(refundId)}`);
      chargeId = objectId(refund.charge);
      paymentIntentId = objectId(refund.payment_intent);
      if (!paymentIntentId && chargeId) {
        const charge = await stripeRequestForMode<Record<string, unknown>>(mode, "GET", `/charges/${encodeURIComponent(chargeId)}`);
        paymentIntentId = objectId(charge.payment_intent);
      }
    }
  } catch { /* Keep the accounting transaction even when a restricted key cannot expand its source. */ }
  const createdAt = stripeTimestampToIso(raw.created) || new Date().toISOString();
  return {
    id: `sbt_${mode}_${String(raw.id || crypto.randomBytes(6).toString("hex"))}`,
    stripeBalanceTransactionId: String(raw.id || ""), mode,
    amountUsd: cents(raw.amount), feeUsd: cents(raw.fee), netUsd: cents(raw.net), currency: String(raw.currency || "usd").toLowerCase(),
    type: String(raw.type || "unknown"), reportingCategory: String(raw.reporting_category || "unknown"), status: String(raw.status || "unknown"),
    sourceId: sourceId || undefined, chargeId: chargeId || undefined, paymentIntentId: paymentIntentId || undefined,
    refundId: refundId || undefined, payoutId: sourceId.startsWith("po_") ? sourceId : undefined,
    description: String(raw.description || "") || undefined, createdAt, availableOn: stripeTimestampToIso(raw.available_on), syncedAt: new Date().toISOString()
  };
}

function detectReconciliationAlerts(db: Database, mode: StripeMode, from: string, to: string) {
  const detected: Omit<BillingReconciliationAlert, "id" | "mode" | "detectedAt" | "lastDetectedAt" | "status">[] = [];
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  const inRange = (value?: string) => Boolean(value) && new Date(String(value)).getTime() >= fromMs && new Date(String(value)).getTime() <= toMs;
  const modeLedger = db.billingLedger.filter((entry) => entry.provider === "stripe" && String(entry.metadata?.stripeMode || "test") === mode);
  const transactions = db.billingStripeBalanceTransactions.filter((item) => item.mode === mode && inRange(item.createdAt));
  for (const order of db.billingCheckoutOrders.filter((item) => item.mode === mode && ["paid", "refunded"].includes(item.status) && inRange(item.paidAt))) {
    const grants = modeLedger.filter((entry) => String(entry.metadata?.checkoutOrderId || "") === order.id && ["purchase", "subscription_grant"].includes(entry.type));
    if (!grants.length) detected.push(alert("payment_without_credits", "critical", `Paid order ${order.id} has no credit grant.`, { orderId: order.id, userId: order.userId, workspaceId: order.workspaceId, amountUsd: order.amountUsd, stripeReference: order.stripePaymentIntentId || order.stripeSubscriptionId }));
    if (grants.length > 1) detected.push(alert("duplicate_credit", "critical", `Paid order ${order.id} has ${grants.length} credit grants.`, { orderId: order.id, userId: order.userId, workspaceId: order.workspaceId, amountUsd: order.amountUsd }));
    if (order.currency !== "usd") detected.push(alert("currency_mismatch", "critical", `Order ${order.id} is ${order.currency}, expected USD.`, { orderId: order.id, amountUsd: order.amountUsd }));
    const payment = transactions.find((item) => item.paymentIntentId && item.paymentIntentId === order.stripePaymentIntentId && item.amountUsd > 0);
    if (payment && Math.abs(payment.amountUsd - order.amountUsd) >= 0.01) detected.push(alert("amount_mismatch", "critical", `Order ${order.id} amount differs from Stripe.`, { orderId: order.id, amountUsd: Math.abs(payment.amountUsd - order.amountUsd), stripeReference: payment.stripeBalanceTransactionId, details: { orderUsd: order.amountUsd, stripeUsd: payment.amountUsd } }));
  }
  for (const entry of modeLedger.filter((item) => ["purchase", "subscription_grant"].includes(item.type))) {
    const orderId = String(entry.metadata?.checkoutOrderId || "");
    const order = db.billingCheckoutOrders.find((item) => item.id === orderId && item.mode === mode);
    if (!order || !["paid", "refunded"].includes(order.status)) detected.push(alert("credits_without_payment", "critical", `Credit grant ${entry.id} has no matching paid order.`, { ledgerEntryId: entry.id, userId: entry.userId, workspaceId: entry.workspaceId, amountUsd: Math.abs(entry.usdCost || 0), stripeReference: entry.stripePaymentIntentId || entry.stripeSubscriptionId }));
  }
  for (const transaction of transactions.filter((item) => item.amountUsd < 0 && /refund/.test(`${item.type} ${item.reportingCategory}`))) {
    const reversal = modeLedger.find((entry) => entry.type === "refund" && entry.stripePaymentIntentId && entry.stripePaymentIntentId === transaction.paymentIntentId);
    if (!reversal) detected.push(alert("refund_without_reversal", "critical", `Stripe refund ${transaction.stripeBalanceTransactionId} has no credit reversal.`, { amountUsd: Math.abs(transaction.amountUsd), stripeReference: transaction.stripeBalanceTransactionId }));
  }
  for (const subscription of db.billingSubscriptions.filter((item) => item.stripeMode === mode && ["active", "trialing"].includes(item.status))) {
    const plan = db.billingPlans.find((item) => item.id === subscription.planId);
    if (!plan || !plan.active) detected.push(alert("subscription_mismatch", "warning", `Subscription ${subscription.stripeSubscriptionId} references an unavailable plan.`, { userId: subscription.userId, workspaceId: subscription.workspaceId, stripeReference: subscription.stripeSubscriptionId }));
  }
  const webhookFailureCutoff = Math.max(fromMs, Date.now() - Number(db.billingSettings.financeWebhookFailureHours || 24) * 3600_000);
  for (const event of db.billingStripeEvents.filter((item) => item.livemode === (mode === "live") && item.status === "failed" && new Date(item.processedAt).getTime() >= webhookFailureCutoff && inRange(item.processedAt))) {
    detected.push(alert("webhook_failure", "critical", `Stripe webhook ${event.stripeEventId} failed: ${event.error || event.type}.`, { stripeReference: event.stripeEventId }));
  }
  for (const workspace of db.workspaces) {
    const balance = calculateCreditBalance(db, workspace.id).available;
    if (balance < 0) detected.push(alert("negative_balance", "critical", `${workspace.name} has a negative credit balance.`, { workspaceId: workspace.id, details: { balance } }));
  }
  const report = buildFinanceReport(db, { mode, from, to });
  if (report.metrics.netSalesUsd > 0 && report.metrics.grossMarginPercent < Number(db.billingSettings.financeMarginAlertPercent || 20)) detected.push(alert("margin_threshold", "warning", `Gross margin ${report.metrics.grossMarginPercent}% is below the configured threshold.`, { amountUsd: report.metrics.grossMarginUsd }));
  if (report.metrics.faceValueLiabilityUsd > Number(db.billingSettings.financeLiabilityAlertUsd || 10000)) detected.push(alert("liability_threshold", "warning", `Credit liability exceeds the configured threshold.`, { amountUsd: report.metrics.faceValueLiabilityUsd }));
  for (const user of report.users.filter((item) => item.providerCostUsd > Number(db.billingSettings.financeHighSpendUserUsd || 500))) detected.push(alert("high_user_spend", "warning", `${user.name} exceeded the configured provider-cost threshold.`, { userId: user.userId, amountUsd: user.providerCostUsd }));
  return detected;
}

function upsertAlerts(db: Database, mode: StripeMode, detected: Omit<BillingReconciliationAlert, "id" | "mode" | "detectedAt" | "lastDetectedAt" | "status">[]) {
  const now = new Date().toISOString();
  const activeIds = new Set<string>();
  for (const item of detected) {
    const alertId = reconciliationAlertId(mode, item);
    activeIds.add(alertId);
    const existing = db.billingReconciliationAlerts.find((alert) => alert.id === alertId);
    if (existing) {
      Object.assign(existing, item, { lastDetectedAt: now });
      if (existing.status === "resolved") existing.status = "open";
    } else db.billingReconciliationAlerts.push({ ...item, id: alertId, mode, status: "open", detectedAt: now, lastDetectedAt: now });
  }
  for (const existing of db.billingReconciliationAlerts.filter((item) => item.mode === mode && item.status === "open")) {
    if (!activeIds.has(existing.id)) {
      existing.status = "resolved";
      existing.resolvedAt = now;
      existing.resolvedBy = "system";
      existing.resolutionNote = "No longer detected by reconciliation.";
    }
  }
}

function reconciliationAlertId(mode: StripeMode, item: { type: string; orderId?: string; ledgerEntryId?: string; stripeReference?: string; workspaceId?: string }) {
  return `fra_${crypto.createHash("sha256").update(`${mode}:${item.type}:${item.orderId || item.ledgerEntryId || item.stripeReference || item.workspaceId || "global"}`).digest("hex").slice(0, 18)}`;
}

function alert(type: BillingReconciliationAlert["type"], severity: BillingReconciliationAlert["severity"], message: string, details: Partial<BillingReconciliationAlert>) {
  const { mode: _mode, id: _id, status: _status, detectedAt: _detectedAt, lastDetectedAt: _lastDetectedAt, ...safeDetails } = details;
  return { type, severity, message, ...safeDetails };
}

function groupUsd<T extends { usdCost: number }>(items: T[], key: (item: T) => string) {
  const grouped = new Map<string, number>();
  items.forEach((item) => grouped.set(key(item), (grouped.get(key(item)) || 0) + Math.abs(item.usdCost || 0)));
  return [...grouped].map(([label, amountUsd]) => ({ label, amountUsd: round(amountUsd) })).sort((a, b) => b.amountUsd - a.amountUsd);
}

function groupCredits<T extends { credits: number }>(items: T[], key: (item: T) => string) {
  const grouped = new Map<string, number>();
  items.forEach((item) => grouped.set(key(item), (grouped.get(key(item)) || 0) + Math.abs(item.credits || 0)));
  return [...grouped].map(([label, credits]) => ({ label, credits: Math.round(credits) })).sort((a, b) => b.credits - a.credits);
}

function validDate(value?: string) {
  if (!value || Number.isNaN(new Date(value).getTime())) return "";
  return new Date(value).toISOString();
}

function startOfDay(date: Date) { const next = new Date(date); next.setHours(0, 0, 0, 0); return next; }
function endOfDay(date: Date) { const next = new Date(date); next.setHours(23, 59, 59, 999); return next; }
function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function cents(value: unknown) { return round(Number(value || 0) / 100); }
function round(value: number) { return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100; }
function sum(values: number[]) { return round(values.reduce((total, value) => total + Number(value || 0), 0)); }
function objectId(value: unknown) { return typeof value === "string" ? value : value && typeof value === "object" ? String((value as Record<string, unknown>).id || "") : ""; }
