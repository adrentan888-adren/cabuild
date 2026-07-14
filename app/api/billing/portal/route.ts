import { NextResponse } from "next/server";
import { getStripeModeKey } from "@/lib/apiKeyOverrides";
import { currentUser } from "@/lib/session";
import { readDb } from "@/lib/store";
import { createStripePortalSession } from "@/lib/stripeBilling";
import type { StripeMode } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await readDb();
  const mode: StripeMode = db.billingSettings.stripeMode === "live" ? "live" : "test";
  const customerId = user.stripeCustomerIds?.[mode] || (mode === "test" ? user.stripeCustomerId : "");
  if (!customerId) {
    return NextResponse.json({ error: "No Stripe customer exists yet. Start a checkout first, then the Customer Portal will be available." }, { status: 400 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const returnUrl = safeReturnUrl(String(body.returnUrl || ""), req.url);
  const portalConfig = await getStripeModeKey(mode, "portal");
  try {
    const session = await createStripePortalSession(mode, {
      customer: customerId,
      return_url: `${returnUrl}/?billing=portal`,
      configuration: portalConfig || undefined
    }, `portal:${user.id}:${Date.now()}`);
    if (!session.url) throw new Error("Stripe did not return a Customer Portal URL.");
    return NextResponse.json({ ok: true, url: session.url });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create Stripe Customer Portal session." }, { status: 400 });
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
