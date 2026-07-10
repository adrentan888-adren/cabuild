import crypto from "crypto";
import { getProviderApiKey } from "./apiKeyOverrides";
import { mutateDb } from "./store";
import type { User, Workspace } from "./types";

const stripeApiBase = "https://api.stripe.com/v1";

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

export async function createStripeCheckoutSession(params: Record<string, string | number | boolean | undefined>, idempotencyKey?: string) {
  return stripeRequest<StripeCheckoutSession>("POST", "/checkout/sessions", params, idempotencyKey);
}

export async function createStripePortalSession(params: Record<string, string | number | boolean | undefined>, idempotencyKey?: string) {
  return stripeRequest<StripePortalSession>("POST", "/billing_portal/sessions", params, idempotencyKey);
}

export async function ensureStripeCustomer(input: { user: User; workspace: Workspace }) {
  if (input.user.stripeCustomerId) return input.user.stripeCustomerId;
  const customer = await stripeRequest<{ id: string }>("POST", "/customers", {
    email: input.user.email,
    name: input.user.name,
    "metadata[userId]": input.user.id,
    "metadata[workspaceId]": input.workspace.id
  }, `customer:${input.user.id}`);
  if (!customer.id) throw new Error("Stripe did not return a customer ID.");
  await mutateDb((db) => {
    const user = db.users.find((item) => item.id === input.user.id);
    if (user) user.stripeCustomerId = customer.id;
  });
  return customer.id;
}

export async function stripeRequest<T>(method: "GET" | "POST", path: string, params?: Record<string, string | number | boolean | undefined>, idempotencyKey?: string): Promise<T> {
  const secretKey = await getProviderApiKey("stripeSecret");
  if (!secretKey) throw new Error("Stripe secret key is not configured. Add it in Admin -> API Key Management or Stripe Settings.");
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

export async function configuredStripeMode() {
  const secretKey = await getProviderApiKey("stripeSecret");
  if (!secretKey) return { configured: false, mode: "missing" as const };
  if (secretKey.startsWith("sk_test_")) return { configured: true, mode: "test" as const };
  if (secretKey.startsWith("sk_live_")) return { configured: true, mode: "live" as const };
  return { configured: true, mode: "unknown" as const };
}

export async function verifyStripeWebhookPayload(payload: string, signatureHeader: string | null) {
  const webhookSecret = await getProviderApiKey("stripeWebhook");
  if (!webhookSecret) throw new Error("Stripe webhook secret is not configured.");
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
