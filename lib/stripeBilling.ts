import crypto from "crypto";
import { getStripeModeKey } from "./apiKeyOverrides";
import { mutateDb } from "./store";
import type { StripeMode, User, Workspace } from "./types";

const stripeApiBase = process.env.STRIPE_API_BASE_URL || "https://api.stripe.com/v1";
const requiredWebhookEvents = [
  "checkout.session.completed",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "charge.refunded"
] as const;

export type StripeCheckoutSession = {
  id: string;
  url?: string;
  customer?: string;
  subscription?: string;
  payment_intent?: string;
  invoice?: string;
  payment_status?: string;
  metadata?: Record<string, string>;
};

export type StripePortalSession = {
  id: string;
  url?: string;
};

export type StripeWebhookEvent = {
  id: string;
  type: string;
  livemode: boolean;
  created?: number;
  data: {
    object: Record<string, unknown>;
  };
};

export type StripeAccountSummary = {
  id: string;
  displayName: string;
  country: string;
  defaultCurrency: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
};

export async function createStripeCheckoutSession(mode: StripeMode, params: Record<string, string | number | boolean | undefined>, idempotencyKey?: string) {
  return stripeRequestForMode<StripeCheckoutSession>(mode, "POST", "/checkout/sessions", params, idempotencyKey);
}

export async function createStripePortalSession(mode: StripeMode, params: Record<string, string | number | boolean | undefined>, idempotencyKey?: string) {
  return stripeRequestForMode<StripePortalSession>(mode, "POST", "/billing_portal/sessions", params, idempotencyKey);
}

export async function ensureStripeCustomer(input: { mode: StripeMode; user: User; workspace: Workspace }) {
  const existingId = input.user.stripeCustomerIds?.[input.mode] || (input.mode === "test" ? input.user.stripeCustomerId : "");
  if (existingId) return existingId;
  const customer = await stripeRequestForMode<{ id: string }>(input.mode, "POST", "/customers", {
    email: input.user.email,
    name: input.user.name,
    "metadata[userId]": input.user.id,
    "metadata[workspaceId]": input.workspace.id,
    "metadata[stripeMode]": input.mode
  }, `customer:${input.mode}:${input.user.id}`);
  if (!customer.id) throw new Error("Stripe did not return a customer ID.");
  await mutateDb((db) => {
    const user = db.users.find((item) => item.id === input.user.id);
    if (user) {
      user.stripeCustomerIds ||= {};
      user.stripeCustomerIds[input.mode] = customer.id;
      if (input.mode === "test") user.stripeCustomerId = customer.id;
    }
  });
  return customer.id;
}

export async function stripeRequestForMode<T>(mode: StripeMode, method: "GET" | "POST", path: string, params?: Record<string, string | number | boolean | undefined>, idempotencyKey?: string): Promise<T> {
  const secretKey = await getStripeModeKey(mode, "secret");
  if (!secretKey) throw new Error(`Stripe ${mode} secret key is not configured. Connect Stripe in Admin -> Billing -> Stripe Connection.`);
  assertStripeKeyMode(secretKey, mode);
  return stripeRequestWithSecret<T>(secretKey, method, path, params, idempotencyKey);
}

export async function stripeRequestWithSecret<T>(secretKey: string, method: "GET" | "POST", path: string, params?: Record<string, string | number | boolean | undefined>, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`
  };
  let body: string | undefined;
  let url = `${stripeApiBase}${path}`;
  if (params && Object.keys(params).length) {
    const encoded = encodeParams(params);
    if (method === "GET") url += `?${encoded}`;
    else {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = encoded;
    }
  }
  if (idempotencyKey && method !== "GET") headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(url, { method, headers, body, cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof json?.error?.message === "string" ? json.error.message : `Stripe API failed with HTTP ${res.status}.`;
    throw new Error(message);
  }
  return json as T;
}

export async function configuredStripeMode(mode: StripeMode) {
  const secretKey = await getStripeModeKey(mode, "secret");
  if (!secretKey) return { configured: false, mode: "missing" as const };
  if (secretKey.startsWith("sk_test_")) return { configured: true, mode: "test" as const };
  if (secretKey.startsWith("sk_live_")) return { configured: true, mode: "live" as const };
  return { configured: true, mode: "unknown" as const };
}

export async function verifyStripeWebhookPayload(payload: string, signatureHeader: string | null, mode: StripeMode) {
  const webhookSecret = await getStripeModeKey(mode, "webhook");
  if (!webhookSecret) throw new Error(`Stripe ${mode} webhook secret is not configured.`);
  if (!signatureHeader) throw new Error("Stripe-Signature header is missing.");
  const pieces = signatureHeader.split(",").map((piece) => piece.trim());
  const timestamp = pieces.find((piece) => piece.startsWith("t="))?.slice(2);
  const signatures = pieces.filter((piece) => piece.startsWith("v1=")).map((piece) => piece.slice(3));
  if (!timestamp || signatures.length === 0) throw new Error("Stripe-Signature header is malformed.");
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) throw new Error("Stripe webhook signature timestamp is outside the allowed tolerance.");
  const expected = crypto.createHmac("sha256", webhookSecret).update(`${timestamp}.${payload}`).digest("hex");
  const matched = signatures.some((signature) => timingSafeEqual(signature, expected));
  if (!matched) throw new Error("Stripe webhook signature verification failed.");
  return JSON.parse(payload) as StripeWebhookEvent;
}

export function assertStripeKeyMode(secretKey: string, mode: StripeMode) {
  const valid = mode === "test" ? secretKey.startsWith("sk_test_") : secretKey.startsWith("sk_live_");
  if (!valid) throw new Error(`Expected a Stripe ${mode} secret key beginning with ${mode === "test" ? "sk_test_" : "sk_live_"}.`);
}

export async function validateStripeAccount(secretKey: string, mode: StripeMode): Promise<StripeAccountSummary> {
  assertStripeKeyMode(secretKey, mode);
  const account = await stripeRequestWithSecret<Record<string, unknown>>(secretKey, "GET", "/account");
  const settings = objectRecord(account.settings);
  const dashboard = objectRecord(settings.dashboard);
  const businessProfile = objectRecord(account.business_profile);
  const id = String(account.id || "");
  if (!id) throw new Error("Stripe did not return an account ID.");
  return {
    id,
    displayName: String(businessProfile.name || dashboard.display_name || `Stripe account ${id}`),
    country: String(account.country || ""),
    defaultCurrency: String(account.default_currency || "usd").toLowerCase(),
    chargesEnabled: Boolean(account.charges_enabled),
    payoutsEnabled: Boolean(account.payouts_enabled)
  };
}

export async function createStripeWebhookEndpoint(secretKey: string, mode: StripeMode, url: string) {
  assertStripeKeyMode(secretKey, mode);
  const params: Record<string, string | number | boolean | undefined> = {
    url,
    description: `Content Agent ${mode} billing webhook`
  };
  requiredWebhookEvents.forEach((event, index) => {
    params[`enabled_events[${index}]`] = event;
  });
  const endpoint = await stripeRequestWithSecret<Record<string, unknown>>(
    secretKey,
    "POST",
    "/webhook_endpoints",
    params,
    `contentagent-webhook:${mode}:${crypto.createHash("sha256").update(url).digest("hex").slice(0, 24)}`
  );
  const id = String(endpoint.id || "");
  const secret = String(endpoint.secret || "");
  if (!id || !secret) throw new Error("Stripe did not return the webhook endpoint ID and signing secret.");
  return { id, secret, url: String(endpoint.url || url), status: String(endpoint.status || "enabled") };
}

export async function retrieveStripeWebhookEndpoint(mode: StripeMode, endpointId: string) {
  return stripeRequestForMode<Record<string, unknown>>(mode, "GET", `/webhook_endpoints/${encodeURIComponent(endpointId)}`);
}

export async function createStripeProduct(mode: StripeMode, input: { name: string; description: string; itemId: string; itemKind: "plan" | "package" }, idempotencyKey: string) {
  return stripeRequestForMode<{ id: string }>(mode, "POST", "/products", {
    name: input.name,
    description: input.description,
    "metadata[contentAgentItemId]": input.itemId,
    "metadata[contentAgentItemKind]": input.itemKind
  }, idempotencyKey);
}

export async function createStripePrice(mode: StripeMode, input: { productId: string; amountUsd: number; itemId: string; revisionId: string; recurring: boolean }, idempotencyKey: string) {
  return stripeRequestForMode<{ id: string }>(mode, "POST", "/prices", {
    product: input.productId,
    unit_amount: Math.round(input.amountUsd * 100),
    currency: "usd",
    ...(input.recurring ? { "recurring[interval]": "month" } : {}),
    "metadata[contentAgentItemId]": input.itemId,
    "metadata[contentAgentRevisionId]": input.revisionId
  }, idempotencyKey);
}

export async function archiveStripePrice(mode: StripeMode, priceId: string) {
  return stripeRequestForMode<Record<string, unknown>>(mode, "POST", `/prices/${encodeURIComponent(priceId)}`, { active: false }, `archive-price:${mode}:${priceId}`);
}

export function stripeTimestampToIso(value: unknown) {
  const seconds = Number(value || 0);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : undefined;
}

export function stripeObjectString(value: Record<string, unknown>, key: string) {
  const next = value[key];
  return typeof next === "string" ? next : "";
}

export function stripeObjectNumber(value: Record<string, unknown>, key: string) {
  const next = Number(value[key] || 0);
  return Number.isFinite(next) ? next : 0;
}

export function stripeMetadata(value: Record<string, unknown>) {
  const metadata = value.metadata;
  if (!metadata || typeof metadata !== "object") return {} as Record<string, string>;
  return Object.fromEntries(Object.entries(metadata as Record<string, unknown>).map(([key, item]) => [key, String(item || "")]));
}

function encodeParams(params: Record<string, string | number | boolean | undefined>) {
  const encoded = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "undefined" || value === "") continue;
    encoded.set(key, String(value));
  }
  return encoded.toString();
}

function timingSafeEqual(a: string, b: string) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
