import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { readDb } from "@/lib/store";
import { createStripeCheckoutSession, ensureStripeCustomer } from "@/lib/stripeBilling";

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
  const workspace = db.workspaces.find((item) => item.id === user.workspaceId);
  if (!workspace) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  const isPlan = kind === "plan";
  const item = isPlan
    ? db.billingPlans.find((plan) => plan.id === itemId && plan.active)
    : db.billingCreditPackages.find((pkg) => pkg.id === itemId && pkg.active);
  if (!item || (kind !== "plan" && kind !== "package")) return NextResponse.json({ error: "Billing product not found." }, { status: 404 });
  if (!item.stripePriceId) return NextResponse.json({ error: `${item.name} has no Stripe price ID configured yet. Add it in Admin -> Billing before opening Checkout.` }, { status: 400 });

  try {
    const customerId = await ensureStripeCustomer({ user, workspace });
    const commonMetadata = {
      "metadata[userId]": user.id,
      "metadata[workspaceId]": workspace.id,
      "metadata[purchaseKind]": kind,
      "metadata[itemId]": item.id,
      "metadata[itemName]": item.name,
      "metadata[credits]": item.totalCredits,
      "metadata[priceUsd]": item.priceUsd
    };
    const session = await createStripeCheckoutSession({
      mode: isPlan ? "subscription" : "payment",
      customer: customerId,
      client_reference_id: user.id,
      success_url: `${returnUrl}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${returnUrl}/?billing=cancelled`,
      allow_promotion_codes: true,
      "line_items[0][price]": item.stripePriceId,
      "line_items[0][quantity]": 1,
      ...commonMetadata,
      ...(isPlan ? {
        "subscription_data[metadata][userId]": user.id,
        "subscription_data[metadata][workspaceId]": workspace.id,
        "subscription_data[metadata][purchaseKind]": kind,
        "subscription_data[metadata][itemId]": item.id,
        "subscription_data[metadata][credits]": item.totalCredits
      } : {
        "payment_intent_data[metadata][userId]": user.id,
        "payment_intent_data[metadata][workspaceId]": workspace.id,
        "payment_intent_data[metadata][purchaseKind]": kind,
        "payment_intent_data[metadata][itemId]": item.id,
        "payment_intent_data[metadata][credits]": item.totalCredits,
        "invoice_creation[enabled]": true
      })
    }, `checkout:${user.id}:${kind}:${item.id}:${Date.now()}`);
    if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
    return NextResponse.json({ ok: true, url: session.url, sessionId: session.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create Stripe Checkout session." }, { status: 400 });
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
