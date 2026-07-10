import { NextResponse } from "next/server";
import { updateWorkspaceCreditBalance } from "@/lib/billing";
import { id, mutateDb } from "@/lib/store";
import { stripeMetadata, stripeObjectNumber, stripeObjectString, stripeTimestampToIso, verifyStripeWebhookPayload } from "@/lib/stripeBilling";
import type { BillingCreditPackage, BillingPlan, BillingSubscriptionState, Database, User, Workspace } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const payload = await req.text();
  let event;
  try {
    event = await verifyStripeWebhookPayload(payload, req.headers.get("stripe-signature"));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid Stripe webhook." }, { status: 400 });
  }

  const result = await mutateDb((db) => {
    db.billingStripeEvents ||= [];
    const existing = db.billingStripeEvents.find((item) => item.stripeEventId === event.id);
    if (existing) return { ok: true, duplicate: true, status: existing.status };
    const now = new Date().toISOString();
    let status: "processed" | "ignored" | "failed" = "processed";
    let error = "";
    const metadata: Record<string, unknown> = { eventType: event.type };
    try {
      const expectedLive = db.billingSettings?.stripeMode === "live";
      if (Boolean(event.livemode) !== expectedLive) {
        throw new Error(`Stripe event mode mismatch. App is ${expectedLive ? "live" : "test"}, event is ${event.livemode ? "live" : "test"}.`);
      }
      const outcome = processStripeEvent(db, event.type, event.data.object, event.id);
      status = outcome.status;
      Object.assign(metadata, outcome.metadata || {});
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message : "Stripe webhook processing failed.";
    }
    db.billingStripeEvents.unshift({
      id: id("sevt"),
      stripeEventId: event.id,
      type: event.type,
      livemode: Boolean(event.livemode),
      status,
      error: error || undefined,
      createdAt: event.created ? new Date(event.created * 1000).toISOString() : now,
      processedAt: now,
      metadata
    });
    return error ? { ok: false, error, httpStatus: 500 as const } : { ok: true, duplicate: false, status };
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.httpStatus });
  return NextResponse.json({ received: true, duplicate: result.duplicate, status: result.status });
}

function processStripeEvent(db: Database, type: string, object: Record<string, unknown>, eventId: string) {
  if (type === "checkout.session.completed") return processCheckoutCompleted(db, object, eventId);
  if (type === "invoice.paid") return processInvoicePaid(db, object, eventId);
  if (type === "invoice.payment_failed") return processInvoicePaymentFailed(db, object);
  if (type === "customer.subscription.updated" || type === "customer.subscription.deleted") return processSubscriptionUpdated(db, object, type);
  if (type === "charge.refunded") return processChargeRefunded(db, object, eventId);
  if (type === "payment_intent.succeeded") return { status: "ignored" as const, metadata: { reason: "PaymentIntent events are informational; Checkout or invoice events grant credits." } };
  return { status: "ignored" as const, metadata: { reason: "Unhandled Stripe event type." } };
}

function processCheckoutCompleted(db: Database, session: Record<string, unknown>, eventId: string) {
  const metadata = stripeMetadata(session);
  const kind = metadata.purchaseKind;
  const user = findUser(db, metadata.userId, objectId(session.customer));
  const workspace = findWorkspace(db, metadata.workspaceId, user);
  saveCustomer(user, session.customer);
  if (kind === "package") {
    const pkg = db.billingCreditPackages.find((item) => item.id === metadata.itemId);
    if (!pkg) throw new Error("Stripe top-up package is no longer configured.");
    grantTopUpCredits(db, { user, workspace, pkg, session, eventId });
    return { status: "processed" as const, metadata: { purchaseKind: kind, packageId: pkg.id, credits: pkg.totalCredits } };
  }
  if (kind === "plan") {
    const plan = db.billingPlans.find((item) => item.id === metadata.itemId);
    if (plan) upsertSubscription(db, { user, workspace, plan, subscriptionId: objectId(session.subscription), customerId: objectId(session.customer), status: "incomplete", latestInvoiceId: objectId(session.invoice) });
    return { status: "processed" as const, metadata: { purchaseKind: kind, planId: plan?.id || metadata.itemId, note: "Subscription credits are granted from invoice.paid." } };
  }
  return { status: "ignored" as const, metadata: { reason: "Checkout session has no recognized purchaseKind metadata." } };
}

function processInvoicePaid(db: Database, invoice: Record<string, unknown>, eventId: string) {
  const metadata = mergeMetadata(stripeMetadata(invoice), nestedMetadata(invoice, "subscription_details"));
  const subscriptionId = objectId(invoice.subscription) || stripeObjectString(metadata, "stripeSubscriptionId");
  if (!subscriptionId) return { status: "ignored" as const, metadata: { reason: "Invoice has no subscription ID." } };
  const customerId = objectId(invoice.customer);
  const user = findUser(db, metadata.userId, customerId);
  const workspace = findWorkspace(db, metadata.workspaceId, user);
  saveCustomer(user, invoice.customer);
  const priceId = metadata.stripePriceId || linePriceId(invoice);
  const plan = db.billingPlans.find((item) => item.id === metadata.itemId) || db.billingPlans.find((item) => item.stripePriceId && item.stripePriceId === priceId);
  if (!plan) throw new Error("Paid Stripe invoice did not match an active billing plan.");
  grantSubscriptionCredits(db, { user, workspace, plan, invoice, eventId, subscriptionId, customerId });
  upsertSubscription(db, {
    user,
    workspace,
    plan,
    subscriptionId,
    customerId,
    status: String(invoice.status || "active"),
    latestInvoiceId: stripeObjectString(invoice, "id"),
    currentPeriodStart: stripeTimestampToIso(nestedNumber(invoice, "lines", "data", 0, "period", "start")),
    currentPeriodEnd: stripeTimestampToIso(nestedNumber(invoice, "lines", "data", 0, "period", "end"))
  });
  (workspace as unknown as { plan: string }).plan = plan.name;
  return { status: "processed" as const, metadata: { planId: plan.id, credits: plan.totalCredits, invoiceId: stripeObjectString(invoice, "id"), subscriptionId } };
}

function processInvoicePaymentFailed(db: Database, invoice: Record<string, unknown>) {
  const subscriptionId = objectId(invoice.subscription);
  if (subscriptionId) {
    const sub = db.billingSubscriptions.find((item) => item.stripeSubscriptionId === subscriptionId);
    if (sub) {
      sub.status = "past_due";
      sub.latestInvoiceId = stripeObjectString(invoice, "id") || sub.latestInvoiceId;
      sub.updatedAt = new Date().toISOString();
    }
  }
  return { status: "processed" as const, metadata: { invoiceId: stripeObjectString(invoice, "id"), subscriptionId, reason: "Payment failed; no credits granted." } };
}

function processSubscriptionUpdated(db: Database, subscription: Record<string, unknown>, eventType: string) {
  const metadata = stripeMetadata(subscription);
  const customerId = objectId(subscription.customer);
  const user = findUser(db, metadata.userId, customerId);
  const workspace = findWorkspace(db, metadata.workspaceId, user);
  saveCustomer(user, subscription.customer);
  const priceId = linePriceIdFromSubscription(subscription);
  const plan = db.billingPlans.find((item) => item.id === metadata.itemId) || db.billingPlans.find((item) => item.stripePriceId && item.stripePriceId === priceId);
  if (plan) {
    upsertSubscription(db, {
      user,
      workspace,
      plan,
      subscriptionId: stripeObjectString(subscription, "id"),
      customerId,
      status: eventType === "customer.subscription.deleted" ? "canceled" : String(subscription.status || "unknown"),
      currentPeriodStart: stripeTimestampToIso(subscription.current_period_start),
      currentPeriodEnd: stripeTimestampToIso(subscription.current_period_end),
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      latestInvoiceId: objectId(subscription.latest_invoice)
    });
  }
  return { status: "processed" as const, metadata: { subscriptionId: stripeObjectString(subscription, "id"), planId: plan?.id, status: eventType === "customer.subscription.deleted" ? "canceled" : subscription.status } };
}

function processChargeRefunded(db: Database, charge: Record<string, unknown>, eventId: string) {
  const paymentIntentId = objectId(charge.payment_intent);
  if (!paymentIntentId) return { status: "ignored" as const, metadata: { reason: "Refunded charge has no payment_intent." } };
  const original = db.billingLedger.find((entry) => entry.stripePaymentIntentId === paymentIntentId && ["purchase", "subscription_grant"].includes(entry.type));
  if (!original) return { status: "ignored" as const, metadata: { reason: "No matching credited ledger entry found for refunded charge.", paymentIntentId } };
  const amount = Math.max(1, stripeObjectNumber(charge, "amount"));
  const amountRefunded = Math.max(0, stripeObjectNumber(charge, "amount_refunded"));
  const targetCreditsToRemove = Math.ceil(Math.abs(original.credits || 0) * Math.min(1, amountRefunded / amount));
  const alreadyRemoved = db.billingLedger
    .filter((entry) => entry.type === "refund" && entry.metadata?.stripePaymentIntentId === paymentIntentId)
    .reduce((sum, entry) => sum + Math.abs(entry.credits || 0), 0);
  const creditsToRemove = Math.max(0, targetCreditsToRemove - alreadyRemoved);
  if (creditsToRemove <= 0) return { status: "ignored" as const, metadata: { reason: "Refund was already reflected in credits.", paymentIntentId } };
  db.billingLedger.push({
    id: id("cred"),
    userId: original.userId,
    workspaceId: original.workspaceId,
    type: "refund",
    module: "billing",
    provider: "stripe",
    action: "stripe.charge_refunded",
    credits: -creditsToRemove,
    usdCost: 0,
    markup: 0,
    status: "refunded",
    relatedId: original.relatedId,
    stripePaymentIntentId: paymentIntentId,
    stripeSubscriptionId: original.stripeSubscriptionId,
    description: `Stripe refund removed ${creditsToRemove.toLocaleString()} credits.`,
    metadata: { stripeEventId: eventId, stripeChargeId: stripeObjectString(charge, "id"), stripePaymentIntentId: paymentIntentId, originalLedgerId: original.id, amount, amountRefunded },
    createdAt: new Date().toISOString()
  });
  updateWorkspaceCreditBalance(db, original.workspaceId);
  return { status: "processed" as const, metadata: { paymentIntentId, creditsRemoved: creditsToRemove } };
}

function grantTopUpCredits(db: Database, input: { user: User; workspace: Workspace; pkg: BillingCreditPackage; session: Record<string, unknown>; eventId: string }) {
  const sessionId = stripeObjectString(input.session, "id");
  if (db.billingLedger.some((entry) => entry.metadata?.stripeCheckoutSessionId === sessionId)) return;
  const expiresAt = input.pkg.expiresAfterDays ? new Date(Date.now() + input.pkg.expiresAfterDays * 86400_000).toISOString() : undefined;
  db.billingLedger.push({
    id: id("cred"),
    userId: input.user.id,
    workspaceId: input.workspace.id,
    type: "purchase",
    module: "billing",
    provider: "stripe",
    action: "stripe.top_up",
    credits: input.pkg.totalCredits,
    usdCost: input.pkg.priceUsd,
    markup: 1,
    status: "succeeded",
    relatedId: input.pkg.id,
    stripePaymentIntentId: objectId(input.session.payment_intent) || undefined,
    description: `Purchased ${input.pkg.name}: ${input.pkg.totalCredits.toLocaleString()} credits.`,
    metadata: { stripeEventId: input.eventId, stripeCheckoutSessionId: sessionId, stripeCustomerId: objectId(input.session.customer), chargeUsd: input.pkg.priceUsd },
    createdAt: new Date().toISOString(),
    expiresAt
  });
  updateWorkspaceCreditBalance(db, input.workspace.id);
}

function grantSubscriptionCredits(db: Database, input: { user: User; workspace: Workspace; plan: BillingPlan; invoice: Record<string, unknown>; eventId: string; subscriptionId: string; customerId: string }) {
  const invoiceId = stripeObjectString(input.invoice, "id");
  if (invoiceId && db.billingLedger.some((entry) => entry.metadata?.stripeInvoiceId === invoiceId)) return;
  const expiresAt = input.plan.expiryDays ? new Date(Date.now() + input.plan.expiryDays * 86400_000).toISOString() : undefined;
  db.billingLedger.push({
    id: id("cred"),
    userId: input.user.id,
    workspaceId: input.workspace.id,
    type: "subscription_grant",
    module: "billing",
    provider: "stripe",
    action: "stripe.subscription_grant",
    credits: input.plan.totalCredits,
    usdCost: input.plan.priceUsd,
    markup: 1,
    status: "succeeded",
    relatedId: input.plan.id,
    stripeSubscriptionId: input.subscriptionId,
    description: `${input.plan.name} subscription credits granted: ${input.plan.totalCredits.toLocaleString()} credits.`,
    metadata: { stripeEventId: input.eventId, stripeInvoiceId: invoiceId, stripeCustomerId: input.customerId, chargeUsd: input.plan.priceUsd },
    createdAt: new Date().toISOString(),
    expiresAt
  });
  updateWorkspaceCreditBalance(db, input.workspace.id);
}

function upsertSubscription(db: Database, input: {
  user: User;
  workspace: Workspace;
  plan: BillingPlan;
  subscriptionId: string;
  customerId: string;
  status: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  latestInvoiceId?: string;
}) {
  if (!input.subscriptionId) return;
  db.billingSubscriptions ||= [];
  const now = new Date().toISOString();
  const existing = db.billingSubscriptions.find((item) => item.stripeSubscriptionId === input.subscriptionId);
  const status = normalizeSubscriptionStatus(input.status);
  const next = {
    workspaceId: input.workspace.id,
    userId: input.user.id,
    planId: input.plan.id,
    stripeCustomerId: input.customerId,
    stripeSubscriptionId: input.subscriptionId,
    status,
    currentPeriodStart: input.currentPeriodStart,
    currentPeriodEnd: input.currentPeriodEnd,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd,
    latestInvoiceId: input.latestInvoiceId,
    updatedAt: now
  };
  if (existing) Object.assign(existing, next);
  else db.billingSubscriptions.push({ id: id("sub"), ...next, createdAt: now });
}

function findUser(db: Database, userId?: string, stripeCustomerId?: string) {
  const user = db.users.find((item) => item.id === userId) || db.users.find((item) => item.stripeCustomerId && item.stripeCustomerId === stripeCustomerId);
  if (!user) throw new Error("Stripe event user could not be matched.");
  return user;
}

function findWorkspace(db: Database, workspaceId: string | undefined, user: User) {
  const workspace = db.workspaces.find((item) => item.id === workspaceId) || db.workspaces.find((item) => item.id === user.workspaceId);
  if (!workspace) throw new Error("Stripe event workspace could not be matched.");
  return workspace;
}

function saveCustomer(user: User, value: unknown) {
  const customerId = objectId(value);
  if (customerId && !user.stripeCustomerId) user.stripeCustomerId = customerId;
}

function objectId(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as Record<string, unknown>).id === "string") return String((value as Record<string, unknown>).id);
  return "";
}

function linePriceId(invoice: Record<string, unknown>) {
  return String(nestedValue(invoice, "lines", "data", 0, "price", "id") || nestedValue(invoice, "lines", "data", 0, "pricing", "price_details", "price") || "");
}

function linePriceIdFromSubscription(subscription: Record<string, unknown>) {
  return String(nestedValue(subscription, "items", "data", 0, "price", "id") || "");
}

function nestedMetadata(object: Record<string, unknown>, key: string) {
  const value = object[key];
  if (!value || typeof value !== "object") return {};
  return stripeMetadata(value as Record<string, unknown>);
}

function mergeMetadata(...items: Record<string, string>[]) {
  return Object.assign({}, ...items.filter(Boolean));
}

function nestedNumber(object: Record<string, unknown>, ...path: Array<string | number>) {
  const value = nestedValue(object, ...path);
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function nestedValue(object: unknown, ...path: Array<string | number>): unknown {
  let current = object;
  for (const part of path) {
    if (current === null || typeof current === "undefined") return undefined;
    if (typeof part === "number" && Array.isArray(current)) current = current[part];
    else if (typeof current === "object") current = (current as Record<string, unknown>)[String(part)];
    else return undefined;
  }
  return current;
}

function normalizeSubscriptionStatus(value: string): BillingSubscriptionState["status"] {
  const allowed: BillingSubscriptionState["status"][] = ["active", "trialing", "past_due", "canceled", "unpaid", "incomplete", "incomplete_expired", "paused"];
  return allowed.includes(value as BillingSubscriptionState["status"]) ? value as BillingSubscriptionState["status"] : "unknown";
}
