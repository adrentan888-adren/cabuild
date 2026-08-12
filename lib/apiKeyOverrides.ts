import crypto from "crypto";
import { mutateDb, readDb } from "./store";
import type { ApiKeyProvider, StripeMode } from "./types";

const providerEnv: Record<ApiKeyProvider, string> = {
  kie: "KIE_API_TOKEN",
  apify: "APIFY_API_TOKEN",
  apifyBackup: "APIFY_BACKUP_API_TOKEN",
  youtube: "YOUTUBE_API_KEY",
  uploadPost: "UPLOAD_POST_API_KEY",
  stripePublishable: "STRIPE_PUBLISHABLE_KEY",
  stripeSecret: "STRIPE_SECRET_KEY",
  stripeWebhook: "STRIPE_WEBHOOK_SECRET",
  stripePortal: "STRIPE_PORTAL_CONFIGURATION_ID",
  stripeTestPublishable: "STRIPE_TEST_PUBLISHABLE_KEY",
  stripeTestSecret: "STRIPE_TEST_SECRET_KEY",
  stripeTestWebhook: "STRIPE_TEST_WEBHOOK_SECRET",
  stripeTestPortal: "STRIPE_TEST_PORTAL_CONFIGURATION_ID",
  stripeLivePublishable: "STRIPE_LIVE_PUBLISHABLE_KEY",
  stripeLiveSecret: "STRIPE_LIVE_SECRET_KEY",
  stripeLiveWebhook: "STRIPE_LIVE_WEBHOOK_SECRET",
  stripeLivePortal: "STRIPE_LIVE_PORTAL_CONFIGURATION_ID"
};

const stripeModeProviders = {
  test: {
    publishable: "stripeTestPublishable",
    secret: "stripeTestSecret",
    webhook: "stripeTestWebhook",
    portal: "stripeTestPortal"
  },
  live: {
    publishable: "stripeLivePublishable",
    secret: "stripeLiveSecret",
    webhook: "stripeLiveWebhook",
    portal: "stripeLivePortal"
  }
} as const;

function encryptionKey() {
  return crypto.createHash("sha256").update(process.env.APP_SECRET || "contentagent-local-secret").digest();
}

export function encryptApiKey(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptApiKey(value: string) {
  const [version, ivRaw, tagRaw, encryptedRaw] = value.split(":");
  if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw) return "";
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64")), decipher.final()]).toString("utf8");
}

export async function getProviderApiKey(provider: ApiKeyProvider) {
  const db = await readDb();
  const override = (db.apiKeyOverrides || []).find((item) => item.provider === provider);
  if (override?.encryptedValue) {
    try {
      const decrypted = decryptApiKey(override.encryptedValue).trim();
      if (decrypted) return decrypted;
    } catch {
      // Fall through to environment secret when stored override cannot be decrypted.
    }
  }
  return process.env[providerEnv[provider]]?.trim() || "";
}

export async function getStripeModeKey(mode: StripeMode, kind: "publishable" | "secret" | "webhook" | "portal") {
  const provider = stripeModeProviders[mode][kind] as ApiKeyProvider;
  const value = await getProviderApiKey(provider);
  if (value) return value;
  if (mode !== "test") return "";
  const legacyProvider = {
    publishable: "stripePublishable",
    secret: "stripeSecret",
    webhook: "stripeWebhook",
    portal: "stripePortal"
  }[kind] as ApiKeyProvider;
  return getProviderApiKey(legacyProvider);
}

export function stripeModeProvider(mode: StripeMode, kind: "publishable" | "secret" | "webhook" | "portal") {
  return stripeModeProviders[mode][kind] as ApiKeyProvider;
}

export function configuredFromEnv(provider: ApiKeyProvider) {
  return Boolean(process.env[providerEnv[provider]]?.trim());
}

export async function apiKeyStatus() {
  const db = await readDb();
  const overrides = db.apiKeyOverrides || [];
  return (Object.keys(providerEnv) as ApiKeyProvider[]).reduce((acc, provider) => {
    const override = overrides.find((item) => item.provider === provider);
    acc[provider] = {
      envConfigured: configuredFromEnv(provider),
      overrideConfigured: Boolean(override),
      updatedAt: override?.updatedAt || "",
      updatedBy: override?.updatedBy || ""
    };
    return acc;
  }, {} as Record<ApiKeyProvider, { envConfigured: boolean; overrideConfigured: boolean; updatedAt: string; updatedBy: string }>);
}

export async function saveApiKeyOverride(provider: ApiKeyProvider, value: string, updatedBy: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("API key cannot be empty.");
  return mutateDb((db) => {
    db.apiKeyOverrides ||= [];
    const now = new Date().toISOString();
    const existing = db.apiKeyOverrides.find((item) => item.provider === provider);
    const next = { provider, encryptedValue: encryptApiKey(trimmed), updatedAt: now, updatedBy };
    if (existing) Object.assign(existing, next);
    else db.apiKeyOverrides.push(next);
    return { provider, updatedAt: now, updatedBy };
  });
}

export async function deleteApiKeyOverrides(providers: ApiKeyProvider[]) {
  return mutateDb((db) => {
    db.apiKeyOverrides ||= [];
    const selected = new Set(providers);
    const before = db.apiKeyOverrides.length;
    db.apiKeyOverrides = db.apiKeyOverrides.filter((item) => !selected.has(item.provider));
    return { removed: before - db.apiKeyOverrides.length };
  });
}

