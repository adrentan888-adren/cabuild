import { NextResponse } from "next/server";
import { updateWorkspaceCreditBalance } from "@/lib/billing";
import { id, mutateDb, readDb } from "@/lib/store";
import { stripeMetadata, stripeObjectNumber, stripeObjectString, stripeTimestampToIso, verifyStripeWebhookPayload } from "@/lib/stripeBilling";
import type { BillingCheckoutOrder, BillingCreditPackage, BillingPlan, BillingStripeCatalogueRevision, BillingSubscriptionState, Database, StripeMode, User, Workspace } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const payload = await req.text();
  const routeMode = stripeModeFromPath(req.url);
  const currentDb = await readDb();
  const mode: StripeMode = routeMode || (currentDb.billingSettings.stripeMode === "live" ? "live" : "test");
  let event;
  try {
    event = await verifyStripeWebhookPayload(payload, req.headers.get("stripe-signature"), mode);
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
    const metadata: Record<string, unknown> = { eventType: event.type, stripeMode: mode };
    try {
      const expectedLive = mode === "live";
      if (Boolean(event.livemode) !== expectedLive) {
        throw new Error(`Stripe event mode mismatch. Endpoint is ${mode}, event is ${event.livemode ? "live" : "test"}.`);
      }
      const profile = db.billingStripeConnections.find((item) => item.mode === mode);
      if (profile) {
        profile.lastWebhookAt = now;
        profile.webhookStatus = "configured";
      }
      const outcome = processStripeEvent(db, event.type, event.data.object, event.id, mode);
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

function processStripeEvent(db: Database, type: string, object: Record<string, unknown>, eventId: string, mode: StripeMode) {
  if (type === "checkout.session.completed") return processCheckoutCompleted(db, object, eventId, mode);
  if (type === "invoice.paid") return processInvoicePaid(db, object, eventId, mode);
  if (type === "invoice.payment_failed") return processInvoicePaymentFailed(db, object);
  if (type === "customer.subscription.updated" || type === "customer.subscription.deleted") return processSubscriptionUpdated(db, object, type, mode);
  if (type === "charge.refunded") return processChargeRefunded(db, object, eventId);
  if (type === "payment_intent.succeeded") return { status: "ignored" as const, metadata: { reason: "PaymentIntent events are informational; Checkout or invoice events grant credits." } };
  return { status: "ignored" as const, metadata: { reason: "Unhandled Stripe event type." } };
}

function processCheckoutCompleted(db: Database, session: Record<string, unknown>, eventId: string, mode: StripeMode) {
  const metadata = stripeMetadata(session);
  const order = findCheckoutOrder(db, metadata.orderId, stripeObjectString(session, "id"));
  const kind = metadata.purchaseKind || order?.itemKind;
  const user = findUser(db, metadata.userId || order?.userId, objectId(session.customer), mode);
  const workspace = findWorkspace(db, metadata.workspaceId || order?.workspaceId, user);
  saveCustomer(user, session.customer, mode);
  if (order) {
    order.status = "paid";
    order.stripeCheckoutSessionId = stripeObjectString(session, "id") || order.stripeCheckoutSessionId;
    order.stripeCustomerId = objectId(session.customer) || order.stripeCustomerId;
    order.stripeSubscriptionId = objectId(session.subscription) || order.stripeSubscriptionId;
    order.stripePaymentIntentId = objectId(session.payment_intent) || order.stripePaymentIntentId;
    order.updatedAt = new Date().toISOString();
    order.paidAt ||= order.updatedAt;
  }
  if (kind === "package") {
    const pkg = db.billingCreditPackages.find((item) => item.id === (metadata.itemId || order?.itemId));
    if (!pkg) throw new Error("Stripe top-up package is no longer configured.");
    grantTopUpCredits(db, { user, workspace, pkg, session, eventId, order });
    return { status: "processed" as const, metadata: { purchaseKind: kind, packageId: pkg.id, credits: order?.creditsPromised || pkg.totalCredits, orderId: order?.id } };
  }
  if (kind === "plan") {
    const plan = db.billingPlans.find((item) => item.id === (metadata.itemId || order?.itemId));
    if (plan) upsertSubscription(db, { user, workspace, plan, mode, catalogueRevisionId: order?.catalogueRevisionId || metadata.catalogueRevisionId, subscriptionId: objectId(session.subscription), customerId: objectId(session.customer), status: "incomplete", latestInvoiceId: objectId(session.invoice) });
    return { status: "processed" as const, metadata: { purchaseKind: kind, planId: plan?.id || metadata.itemId, orderId: order?.id, note: "Subscription credits are granted from invoice.paid." } };
  }
  return { status: "ignored" as const, metadata: { reason: "Checkout session has no recognized purchaseKind metadata." } };
}

function processInvoicePaid(db: Database, invoice: Record<string, unknown>, eventId: string, mode: StripeMode) {
  const metadata = mergeMetadata(stripeMetadata(invoice), nestedMetadata(invoice, "subscription_details"));
  const subscriptionId = objectId(invoice.subscription) || stripeObjectString(metadata, "stripeSubscriptionId");
  if (!subscriptionId) return { status: "ignored" as const, metadata: { reason: "Invoice has no subscription ID." } };
  const customerId = objectId(invoice.customer);
  const subscriptionState = db.billingSubscriptions.find((item) => item.stripeSubscriptionId === subscriptionId);
  const order = findCheckoutOrder(db, metadata.orderId) || db.billingCheckoutOrders.find((item) => item.stripeSubscriptionId === subscriptionId);
  const user = findUser(db, metadata.userId || order?.userId || subscriptionState?.userId, customerId, mode);
  const workspace = findWorkspace(db, metadata.workspaceId || order?.workspaceId || subscriptionState?.workspaceId, user);
  saveCustomer(user, invoice.customer, mode);
  const priceId = metadata.stripePriceId || linePriceId(invoice);
  const mappedPlanId = db.billingStripeCatalogueMappings.find((item) => item.mode === mode && item.itemKind === "plan" && item.priceId === priceId)?.itemId;
  const plan = db.billingPlans.find((item) => item.id === (metadata.itemId || order?.itemId || subscriptionState?.planId || mappedPlanId)) || db.billingPlans.find((item) => item.stripePriceId && item.stripePriceId === priceId);
  if (!plan) throw new Error("Paid Stripe invoice did not match an active billing plan.");
  const revisionId = order?.catalogueRevisionId || metadata.catalogueRevisionId || subscriptionState?.catalogueRevisionId;
  const revision = db.billingStripeCatalogueRevisions.find((item) => item.id === revisionId);
  grantSubscriptionCredits(db, { user, workspace, plan, revision, invoice, eventId, subscriptionId, customerId, order });
  if (order) {
    order.status = "paid";
    order.stripeInvoiceId = stripeObjectString(invoice, "id") || order.stripeInvoiceId;
    order.stripeSubscriptionId = subscriptionId;
    order.updatedAt = new Date().toISOString();
    order.paidAt ||= order.updatedAt;
  }
  upsertSubscription(db, {
    user,
    workspace,
    plan,
    mode,
    catalogueRevisionId: revisionId,
    subscriptionId,
    customerId,
    status: String(invoice.status || "active"),
    latestInvoiceId: stripeObjectString(invoice, "id"),
    currentPeriodStart: stripeTimestampToIso(nestedNumber(invoice, "lines", "data", 0, "period", "start")),
    currentPeriodEnd: stripeTimestampToIso(nestedNumber(invoice, "lines", "data", 0, "period", "end"))
  });
  (workspace as unknown as { plan: string }).plan = plan.name;
  return { status: "processed" as const, metadata: { planId: plan.id, credits: revision?.totalCredits || order?.creditsPromised || plan.totalCredits, invoiceId: stripeObjectString(invoice, "id"), subscriptionId, orderId: order?.id, catalogueRevisionId: revisionId } };
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

function processSubscriptionUpdated(db: Database, subscription: Record<string, unknown>, eventType: string, mode: StripeMode) {
  const metadata = stripeMetadata(subscription);
  const customerId = objectId(subscription.customer);
  const user = findUser(db, metadata.userId, customerId, mode);
  const workspace = findWorkspace(db, metadata.workspaceId, user);
  saveCustomer(user, subscription.customer, mode);
  const priceId = linePriceIdFromSubscription(subscription);
  const catalogueMapping = db.billingStripeCatalogueMappings.find((item) => item.mode === mode && item.itemKind === "plan" && item.priceId === priceId);
  const plan = db.billingPlans.find((item) => item.id === (metadata.itemId || catalogueMapping?.itemId)) || db.billingPlans.find((item) => item.stripePriceId && item.stripePriceId === priceId);
  if (plan) {
    upsertSubscription(db, {
      user,
      workspace,
      plan,
      mode,
      catalogueRevisionId: metadata.catalogueRevisionId || catalogueMapping?.revisionId,
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

function grantTopUpCredits(db: Database, input: { user: User; workspace: Workspace; pkg: BillingCreditPackage; session: Record<string, unknown>; eventId: string; order?: BillingCheckoutOrder }) {
  const sessionId = stripeObjectString(input.session, "id");
  if (db.billingLedger.some((entry) => entry.metadata?.stripeCheckoutSessionId === sessionId)) return;
  const credits = input.order?.creditsPromised || input.pkg.totalCredits;
  const chargeUsd = input.order?.amountUsd ?? input.pkg.priceUsd;
  const expiryDays = input.order?.expiryDays ?? input.pkg.expiresAfterDays;
  const expiresAt = expiryDays ? new Date(Date.now() + expiryDays * 86400_000).toISOString() : undefined;
  db.billingLedger.push({
    id: id("cred"),
    userId: input.user.id,
    workspaceId: input.workspace.id,
    type: "purchase",
    module: "billing",
    provider: "stripe",
    action: "stripe.top_up",
    credits,
    usdCost: chargeUsd,
    markup: 1,
    status: "succeeded",
    relatedId: input.pkg.id,
    stripePaymentIntentId: objectId(input.session.payment_intent) || undefined,
    description: `Purchased ${input.order?.itemName || input.pkg.name}: ${credits.toLocaleString()} credits.`,
    metadata: { stripeEventId: input.eventId, stripeCheckoutSessionId: sessionId, stripeCustomerId: objectId(input.session.customer), chargeUsd, checkoutOrderId: input.order?.id, catalogueRevisionId: input.order?.catalogueRevisionId, stripeMode: input.order?.mode },
    createdAt: new Date().toISOString(),
    expiresAt
  });
  updateWorkspaceCreditBalance(db, input.workspace.id);
}

function grantSubscriptionCredits(db: Database, input: { user: User; workspace: Workspace; plan: BillingPlan; revision?: BillingStripeCatalogueRevision; order?: BillingCheckoutOrder; invoice: Record<string, unknown>; eventId: string; subscriptionId: string; customerId: string }) {
  const invoiceId = stripeObjectString(input.invoice, "id");
  if (invoiceId && db.billingLedger.some((entry) => entry.metadata?.stripeInvoiceId === invoiceId)) return;
  const credits = input.revision?.totalCredits || input.order?.creditsPromised || input.plan.totalCredits;
  const chargeUsd = input.revision?.amountUsd ?? input.order?.amountUsd ?? input.plan.priceUsd;
  const expiryDays = input.revision?.expiryDays ?? input.order?.expiryDays ?? input.plan.expiryDays;
  const expiresAt = expiryDays ? new Date(Date.now() + expiryDays * 86400_000).toISOString() : undefined;
  db.billingLedger.push({
    id: id("cred"),
    userId: input.user.id,
    workspaceId: input.workspace.id,
    type: "subscription_grant",
    module: "billing",
    provider: "stripe",
    action: "stripe.subscription_grant",
    credits,
    usdCost: chargeUsd,
    markup: 1,
    status: "succeeded",
    relatedId: input.plan.id,
    stripeSubscriptionId: input.subscriptionId,
    description: `${input.revision?.itemName || input.order?.itemName || input.plan.name} subscription credits granted: ${credits.toLocaleString()} credits.`,
    metadata: { stripeEventId: input.eventId, stripeInvoiceId: invoiceId, stripeCustomerId: input.customerId, chargeUsd, checkoutOrderId: input.order?.id, catalogueRevisionId: input.revision?.id || input.order?.catalogueRevisionId, stripeMode: input.revision?.mode || input.order?.mode },
    createdAt: new Date().toISOString(),
    expiresAt
  });
  updateWorkspaceCreditBalance(db, input.workspace.id);
}

function upsertSubscription(db: Database, input: {
  user: User;
  workspace: Workspace;
  plan: BillingPlan;
  mode: StripeMode;
  catalogueRevisionId?: string;
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
    stripeMode: input.mode,
    catalogueRevisionId: input.catalogueRevisionId,
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

function findUser(db: Database, userId: string | undefined, stripeCustomerId: string | undefined, mode: StripeMode) {
  const user = db.users.find((item) => item.id === userId)
    || db.users.find((item) => item.stripeCustomerIds?.[mode] && item.stripeCustomerIds[mode] === stripeCustomerId)
    || (mode === "test" ? db.users.find((item) => item.stripeCustomerId && item.stripeCustomerId === stripeCustomerId) : undefined);
  if (!user) throw new Error("Stripe event user could not be matched.");
  return user;
}

function findWorkspace(db: Database, workspaceId: string | undefined, user: User) {
  const workspace = db.workspaces.find((item) => item.id === workspaceId) || db.workspaces.find((item) => item.id === user.workspaceId);
  if (!workspace) throw new Error("Stripe event workspace could not be matched.");
  return workspace;
}

function saveCustomer(user: User, value: unknown, mode: StripeMode) {
  const customerId = objectId(value);
  if (!customerId) return;
  user.stripeCustomerIds ||= {};
  user.stripeCustomerIds[mode] ||= customerId;
  if (mode === "test" && !user.stripeCustomerId) user.stripeCustomerId = customerId;
}

function findCheckoutOrder(db: Database, orderId?: string, sessionId?: string) {
  return (orderId ? db.billingCheckoutOrders.find((item) => item.id === orderId) : undefined)
    || (sessionId ? db.billingCheckoutOrders.find((item) => item.stripeCheckoutSessionId === sessionId) : undefined);
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

function stripeModeFromPath(value: string): StripeMode | null {
  const pathname = new URL(value).pathname.replace(/\/$/, "");
  if (pathname.endsWith("/test")) return "test";
  if (pathname.endsWith("/live")) return "live";
  return null;
}
