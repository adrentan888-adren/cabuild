import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { id, mutateDb, readDb } from "@/lib/store";
import { createStripeCheckoutSession, ensureStripeCustomer } from "@/lib/stripeBilling";
import { liveCheckoutAccess } from "@/lib/stripeLaunch";
import type { StripeMode } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid checkout request." }, { status: 400 });
  }
  const kind = String(body.kind || "");
  const itemId = String(body.itemId || "");
  const returnUrl = safeReturnUrl(String(body.returnUrl || ""), req.url);
  const db = await readDb();
  const stripeMode: StripeMode = db.billingSettings.stripeMode === "live" ? "live" : "test";
  const connection = db.billingStripeConnections.find((item) => item.mode === stripeMode);
  if (!connection?.checkoutEnabled || !db.billingSettings.stripeCheckoutEnabled?.[stripeMode]) {
    return NextResponse.json({ error: `Stripe ${stripeMode} Checkout is currently disabled. An admin must connect Stripe, synchronize the catalogue, and enable Checkout.` }, { status: 503 });
  }
  if (stripeMode === "live") {
    const access = liveCheckoutAccess(db, user);
    if (!access.allowed) return NextResponse.json({ error: access.reason, rolloutStage: access.stage }, { status: 403 });
  }
  const workspace = db.workspaces.find((item) => item.id === user.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  const isPlan = kind === "plan";
  const item = isPlan
    ? db.billingPlans.find((plan) => plan.id === itemId && plan.active)
    : db.billingCreditPackages.find((pkg) => pkg.id === itemId && pkg.active);
  if (!item || (kind !== "plan" && kind !== "package")) return NextResponse.json({ error: "Billing product not found." }, { status: 404 });
  const mapping = db.billingStripeCatalogueMappings.find((entry) => entry.mode === stripeMode && entry.itemKind === kind && entry.itemId === item.id && entry.active && entry.status === "synced");
  const revision = mapping ? db.billingStripeCatalogueRevisions.find((entry) => entry.id === mapping.revisionId) : undefined;
  if (!mapping || !revision) return NextResponse.json({ error: `${item.name} is not synchronized with the Stripe ${stripeMode} catalogue yet.` }, { status: 400 });

  const orderId = id("order");
  const now = new Date().toISOString();
  await mutateDb((next) => {
    next.billingCheckoutOrders.unshift({
      id: orderId,
      mode: stripeMode,
      userId: user.id,
      workspaceId: workspace.id,
      itemKind: isPlan ? "plan" : "package",
      itemId: item.id,
      itemName: revision.itemName,
      catalogueRevisionId: revision.id,
      stripePriceId: revision.priceId,
      amountUsd: revision.amountUsd,
      currency: revision.currency,
      creditsPromised: revision.totalCredits,
      expiryDays: revision.expiryDays,
      status: "pending",
      createdAt: now,
      updatedAt: now
    });
  });

  try {
    const customerId = await ensureStripeCustomer({ mode: stripeMode, user, workspace });
    const commonMetadata = {
      "metadata[orderId]": orderId,
      "metadata[catalogueRevisionId]": revision.id,
      "metadata[stripeMode]": stripeMode,
      "metadata[userId]": user.id,
      "metadata[workspaceId]": workspace.id,
      "metadata[purchaseKind]": kind,
      "metadata[itemId]": item.id,
      "metadata[itemName]": item.name,
      "metadata[credits]": revision.totalCredits,
      "metadata[priceUsd]": revision.amountUsd
    };
    const session = await createStripeCheckoutSession(stripeMode, {
      mode: isPlan ? "subscription" : "payment",
      customer: customerId,
      client_reference_id: user.id,
      success_url: `${returnUrl}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${returnUrl}/?billing=cancelled`,
      allow_promotion_codes: true,
      "line_items[0][price]": revision.priceId,
      "line_items[0][quantity]": 1,
      ...commonMetadata,
      ...(isPlan ? {
        "subscription_data[metadata][orderId]": orderId,
        "subscription_data[metadata][catalogueRevisionId]": revision.id,
        "subscription_data[metadata][stripeMode]": stripeMode,
        "subscription_data[metadata][userId]": user.id,
        "subscription_data[metadata][workspaceId]": workspace.id,
        "subscription_data[metadata][purchaseKind]": kind,
        "subscription_data[metadata][itemId]": item.id,
        "subscription_data[metadata][credits]": revision.totalCredits
      } : {
        "payment_intent_data[metadata][orderId]": orderId,
        "payment_intent_data[metadata][catalogueRevisionId]": revision.id,
        "payment_intent_data[metadata][stripeMode]": stripeMode,
        "payment_intent_data[metadata][userId]": user.id,
        "payment_intent_data[metadata][workspaceId]": workspace.id,
        "payment_intent_data[metadata][purchaseKind]": kind,
        "payment_intent_data[metadata][itemId]": item.id,
        "payment_intent_data[metadata][credits]": revision.totalCredits,
        "invoice_creation[enabled]": true
      })
    }, `checkout:${stripeMode}:${orderId}`);
    if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
    await mutateDb((next) => {
      const order = next.billingCheckoutOrders.find((entry) => entry.id === orderId);
      if (!order) return;
      order.status = "checkout_created";
      order.stripeCheckoutSessionId = session.id;
      order.stripeCustomerId = customerId;
      order.updatedAt = new Date().toISOString();
    });
    return NextResponse.json({ ok: true, url: session.url, sessionId: session.id, orderId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create Stripe Checkout session.";
    await mutateDb((next) => {
      const order = next.billingCheckoutOrders.find((entry) => entry.id === orderId);
      if (!order) return;
      order.status = "failed";
      order.error = message;
      order.updatedAt = new Date().toISOString();
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function safeReturnUrl(value: string, fallbackUrl: string) {
  try {
    const url = new URL(value || fallbackUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    const fallback = new URL(fallbackUrl);
    return `${fallback.protocol}//${fallback.host}`;
  }
}
