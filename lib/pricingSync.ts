import { getProviderApiKey } from "./apiKeyOverrides";
import type {
  BillingPricingAlert,
  BillingPricingAlertStatus,
  BillingProvider,
  BillingRateCard,
  BillingRateUnit,
  Database
} from "./types";

export type PricingSyncProposal = Omit<BillingPricingAlert, "id" | "runId" | "createdAt" | "decidedAt" | "decidedBy" | "appliedAt">;

export type PricingSyncScan = {
  scannedCount: number;
  proposals: PricingSyncProposal[];
};

const KIE_CATALOG: Record<string, { baseCostUsd: number; unit: BillingRateUnit; source: PricingSyncProposal["source"]; note: string }> = {
  "veo3_fast": { baseCostUsd: 0.30, unit: "per_action", source: "manual_catalog", note: "Catalog fallback for VEO Fast 720p." },
  "bytedance/seedance-2": { baseCostUsd: 0.205, unit: "per_second", source: "manual_catalog", note: "Catalog fallback for Seedance 2.0 720p." },
  "gpt-image-2:1k": { baseCostUsd: 0.03, unit: "per_image", source: "manual_catalog", note: "Catalog fallback for GPT Image 2 1K." },
  "gpt-image-2:2k": { baseCostUsd: 0.05, unit: "per_image", source: "manual_catalog", note: "Catalog fallback for GPT Image 2 2K." },
  "gpt-image-2:4k": { baseCostUsd: 0.08, unit: "per_image", source: "manual_catalog", note: "Catalog fallback for GPT Image 2 4K." },
  "nano-banana-pro:1-2k": { baseCostUsd: 0.09, unit: "per_image", source: "manual_catalog", note: "Catalog fallback for Nano Banana Pro 1/2K." },
  "nano-banana-pro:4k": { baseCostUsd: 0.12, unit: "per_image", source: "manual_catalog", note: "Catalog fallback for Nano Banana Pro 4K." },
  "gpt-5.5:input": { baseCostUsd: 0.0014, unit: "per_1k_tokens", source: "manual_catalog", note: "Catalog fallback for GPT-5.5 input tokens." },
  "gpt-5.5:output": { baseCostUsd: 0.0084, unit: "per_1k_tokens", source: "manual_catalog", note: "Catalog fallback for GPT-5.5 output tokens." },
  "gemini-3.5-flash:input": { baseCostUsd: 0.00045, unit: "per_1k_tokens", source: "manual_catalog", note: "Catalog fallback for Gemini 3.5 Flash input tokens." },
  "gemini-3.5-flash:output": { baseCostUsd: 0.0027, unit: "per_1k_tokens", source: "manual_catalog", note: "Catalog fallback for Gemini 3.5 Flash output tokens." },
  "claude-opus-4.8:input": { baseCostUsd: 0.002, unit: "per_1k_tokens", source: "manual_catalog", note: "Catalog fallback for Claude Opus 4.8 input tokens." },
  "claude-opus-4.8:output": { baseCostUsd: 0.010, unit: "per_1k_tokens", source: "manual_catalog", note: "Catalog fallback for Claude Opus 4.8 output tokens." }
};

export async function collectPricingSyncProposals(db: Database, provider: BillingProvider): Promise<PricingSyncScan> {
  const rateCards = (db.billingRateCards || []).filter((card) => card.provider === provider);
  if (provider === "kie") return syncKie(db, rateCards);
  if (provider === "apify") return syncApify(db, rateCards);
  return {
    scannedCount: rateCards.length,
    proposals: rateCards
      .filter((card) => !hasOpenAlert(db, card.id))
      .map((card) => manualProposal(card, "Provider pricing sync for this provider is not automated yet. Keep this card manual until a supported pricing endpoint is added."))
  };
}

async function syncKie(db: Database, rateCards: BillingRateCard[]): Promise<PricingSyncScan> {
  const page = await fetchKiePricingPage();
  const proposals = rateCards.flatMap((card) => {
    if (hasOpenAlert(db, card.id)) return [];
    const catalog = KIE_CATALOG[card.modelOrActorId];
    if (!catalog) {
      return [manualProposal(card, `Kie pricing page was ${page.ok ? "reachable" : "not reachable"}, but no reliable parser/catalog entry exists for this model.`)];
    }
    const reason = page.ok
      ? `${catalog.note} Kie's public pricing page was reachable, but this sync only applies prices after admin review.`
      : `${catalog.note} Kie pricing page could not be fetched (${page.error || "unknown error"}), so the saved fallback catalog was used for comparison.`;
    return priceProposal(card, catalog.baseCostUsd, catalog.unit, catalog.source, reason, { pricingPageFetched: page.ok, pricingPageError: page.error });
  });
  return { scannedCount: rateCards.length, proposals };
}

async function syncApify(db: Database, rateCards: BillingRateCard[]): Promise<PricingSyncScan> {
  const token = await getProviderApiKey("apify") || await getProviderApiKey("apifyBackup");
  const proposals: PricingSyncProposal[] = [];
  for (const card of rateCards) {
    if (hasOpenAlert(db, card.id)) continue;
    const actor = await fetchApifyActor(card.modelOrActorId, token);
    if (!actor.ok) {
      proposals.push(manualProposal(card, `Apify actor metadata could not be fetched for ${card.modelOrActorId}: ${actor.error}.`, actor.metadata));
      continue;
    }
    const extracted = extractApifyPrice(actor.data);
    if (!extracted) {
      proposals.push(manualProposal(card, `Apify actor metadata was fetched, but no confident per-1k-results price was found. Review this actor manually.`, actor.metadata));
      continue;
    }
    proposals.push(...priceProposal(card, extracted.baseCostUsd, extracted.unit, "apify_actor_metadata", extracted.reason, { ...actor.metadata, pricePath: extracted.path }));
  }
  return { scannedCount: rateCards.length, proposals };
}

function priceProposal(card: BillingRateCard, newBaseCostUsd: number, newUnit: BillingRateUnit, source: PricingSyncProposal["source"], reason: string, metadata?: Record<string, unknown>) {
  const oldCost = roundUsd(card.baseCostUsd);
  const nextCost = roundUsd(newBaseCostUsd);
  const unitChanged = card.unit !== newUnit;
  if (!unitChanged && Math.abs(oldCost - nextCost) < 0.000001) return [];
  const changePercent = oldCost > 0 ? roundPercent(((nextCost - oldCost) / oldCost) * 100) : undefined;
  return [{
    provider: card.provider,
    rateCardId: card.id,
    label: card.label,
    modelOrActorId: card.modelOrActorId,
    oldBaseCostUsd: oldCost,
    newBaseCostUsd: nextCost,
    oldUnit: card.unit,
    newUnit,
    changePercent,
    status: "pending_review" as BillingPricingAlertStatus,
    source,
    reason,
    metadata
  }];
}

function manualProposal(card: BillingRateCard, reason: string, metadata?: Record<string, unknown>): PricingSyncProposal {
  return {
    provider: card.provider,
    rateCardId: card.id,
    label: card.label,
    modelOrActorId: card.modelOrActorId,
    oldBaseCostUsd: roundUsd(card.baseCostUsd),
    oldUnit: card.unit,
    status: "manual_required",
    source: "manual_required",
    reason,
    metadata
  };
}

function hasOpenAlert(db: Database, rateCardId: string) {
  return (db.billingPricingAlerts || []).some((alert) => alert.rateCardId === rateCardId && ["pending_review", "manual_required"].includes(alert.status));
}

async function fetchKiePricingPage() {
  try {
    const res = await fetch("https://kie.ai/pricing", { cache: "no-store" });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    await res.text();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "request failed" };
  }
}

async function fetchApifyActor(actorId: string, token: string) {
  const encoded = encodeURIComponent(actorId.replace("/", "~"));
  const urls = [`https://api.apify.com/v2/actors/${encoded}`, `https://api.apify.com/v2/acts/${encoded}`];
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  let lastError = "";
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers, cache: "no-store" });
      const text = await res.text();
      if (!res.ok) {
        lastError = `HTTP ${res.status}${text ? `: ${truncate(text, 180)}` : ""}`;
        continue;
      }
      const json = JSON.parse(text) as { data?: unknown };
      const data = json.data ?? json;
      return {
        ok: true as const,
        data,
        metadata: { actorEndpoint: url.replace(encoded, actorId.replace("/", "~")), actorTitle: objectValue(data, "title"), actorModifiedAt: objectValue(data, "modifiedAt") }
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "request failed";
    }
  }
  return { ok: false as const, error: lastError || "request failed", metadata: { actorId } };
}

function extractApifyPrice(data: unknown) {
  const matches: { path: string; value: number; unit: BillingRateUnit; reason: string }[] = [];
  walk(data, "", (path, value) => {
    const key = path.toLowerCase();
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return;
    if (/(price|usd).*(thousand|1000|1k).*result/.test(key) || /(thousand|1000|1k).*result.*(price|usd)/.test(key)) {
      matches.push({ path, value: number, unit: "per_1k_results", reason: `Found Apify per-1k-results price in metadata field ${path}.` });
    }
    if (/(price|usd).*per.*result/.test(key) || /per.*result.*(price|usd)/.test(key)) {
      matches.push({ path, value: number * 1000, unit: "per_1k_results", reason: `Found Apify per-result price in metadata field ${path}; converted to per 1,000 results.` });
    }
    if (/(computeunit|compute_unit|cu).*(price|usd)/.test(key) || /(price|usd).*(computeunit|compute_unit|cu)/.test(key)) {
      matches.push({ path, value: number, unit: "per_action", reason: `Found Apify compute-unit price in metadata field ${path}. Review unit fit before approving.` });
    }
  });
  const best = matches.find((match) => match.unit === "per_1k_results") || matches[0];
  if (!best) return null;
  return { baseCostUsd: roundUsd(best.value), unit: best.unit, reason: best.reason, path: best.path };
}

function walk(value: unknown, path: string, visit: (path: string, value: unknown) => void, seen = new Set<unknown>()) {
  if (value === null || typeof value !== "object") {
    visit(path, value);
    return;
  }
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, visit, seen));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    walk(child, path ? `${path}.${key}` : key, visit, seen);
  }
}

function objectValue(value: unknown, key: string) {
  if (!value || typeof value !== "object") return undefined;
  const item = (value as Record<string, unknown>)[key];
  return typeof item === "string" || typeof item === "number" || typeof item === "boolean" ? item : undefined;
}

function roundUsd(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function roundPercent(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length)}...` : value;
}
