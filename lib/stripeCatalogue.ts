import crypto from "crypto";
import { archiveStripePrice, createStripePrice, createStripeProduct, stripeRequestForMode } from "./stripeBilling";
import { id, mutateDb, readDb } from "./store";
import type { BillingCreditPackage, BillingPlan, BillingStripeCatalogueRevision, Database, StripeMode } from "./types";

type CatalogueItem = (BillingPlan | BillingCreditPackage) & { kind: "plan" | "package" };

export async function syncStripeCatalogue(input: {
  mode: StripeMode;
  actorId: string;
  reason?: string;
  subscriptionPolicy?: "new_customers_only";
}) {
  const db = await readDb();
  const connection = db.billingStripeConnections.find((item) => item.mode === input.mode);
  if (!connection || connection.status !== "connected") throw new Error(`Connect the Stripe ${input.mode} account before synchronizing the catalogue.`);
  const items: CatalogueItem[] = [
    ...db.billingPlans.filter((item) => item.active).map((item) => ({ ...item, kind: "plan" as const })),
    ...db.billingCreditPackages.filter((item) => item.active).map((item) => ({ ...item, kind: "package" as const }))
  ];
  const results: { itemId: string; name: string; status: "created" | "unchanged" | "failed"; priceId?: string; error?: string }[] = [];

  for (const item of items) {
    try {
      const latestDb = await readDb();
      const activeMapping = latestDb.billingStripeCatalogueMappings.find((mapping) => mapping.mode === input.mode && mapping.itemKind === item.kind && mapping.itemId === item.id && mapping.active);
      const activeRevision = activeMapping
        ? latestDb.billingStripeCatalogueRevisions.find((revision) => revision.id === activeMapping.revisionId)
        : undefined;
      if (activeMapping && activeRevision && revisionMatches(activeRevision, item)) {
        if (activeMapping.status !== "synced") {
          await mutateDb((next) => {
            const mapping = next.billingStripeCatalogueMappings.find((entry) => entry.id === activeMapping.id);
            if (mapping) {
              mapping.status = "synced";
              mapping.error = undefined;
              mapping.updatedAt = new Date().toISOString();
            }
          });
        }
        results.push({ itemId: item.id, name: item.name, status: "unchanged", priceId: activeMapping.priceId });
        continue;
      }

      const previousMapping = activeMapping || latestDb.billingStripeCatalogueMappings.find((mapping) => mapping.mode === input.mode && mapping.itemKind === item.kind && mapping.itemId === item.id && Boolean(mapping.productId));
      let productId = previousMapping?.productId || "";
      if (!productId) {
        const product = await createStripeProduct(input.mode, {
          name: item.name,
          description: item.kind === "plan" ? `${item.totalCredits.toLocaleString()} Content Agent credits per month` : `${item.totalCredits.toLocaleString()} Content Agent credits`,
          itemId: item.id,
          itemKind: item.kind
        }, operationKey("product", input.mode, item.id));
        productId = product.id;
      } else {
        await stripeRequestForMode(input.mode, "POST", `/products/${encodeURIComponent(productId)}`, {
          name: item.name,
          description: item.kind === "plan" ? `${item.totalCredits.toLocaleString()} Content Agent credits per month` : `${item.totalCredits.toLocaleString()} Content Agent credits`
        }, operationKey("product-update", input.mode, item.id, offerFingerprint(item)));
      }
      if (!productId) throw new Error("Stripe did not return a Product ID.");

      const revisionId = id("srev");
      const price = await createStripePrice(input.mode, {
        productId,
        amountUsd: item.priceUsd,
        itemId: item.id,
        revisionId,
        recurring: item.kind === "plan"
      }, operationKey("price", input.mode, item.id, offerFingerprint(item)));
      if (!price.id) throw new Error("Stripe did not return a Price ID.");

      let archiveWarning = "";
      if (activeMapping?.priceId && activeMapping.priceId !== price.id) {
        try {
          await archiveStripePrice(input.mode, activeMapping.priceId);
        } catch (error) {
          archiveWarning = error instanceof Error ? error.message : "Old Stripe Price could not be archived.";
        }
      }

      await mutateDb((next) => {
        const now = new Date().toISOString();
        for (const mapping of next.billingStripeCatalogueMappings) {
          if (mapping.mode === input.mode && mapping.itemKind === item.kind && mapping.itemId === item.id && mapping.active) {
            mapping.active = false;
            mapping.status = "archived";
            mapping.updatedAt = now;
          }
        }
        for (const revision of next.billingStripeCatalogueRevisions) {
          if (revision.mode === input.mode && revision.itemKind === item.kind && revision.itemId === item.id && !revision.retiredAt) revision.retiredAt = now;
        }
        next.billingStripeCatalogueRevisions.push(toRevision({ revisionId, mode: input.mode, item, productId, priceId: price.id, actorId: input.actorId, reason: input.reason || "Stripe catalogue synchronized from Content Agent." }));
        next.billingStripeCatalogueMappings.push({
          id: id("smap"),
          mode: input.mode,
          itemKind: item.kind,
          itemId: item.id,
          productId,
          priceId: price.id,
          revisionId,
          amountUsd: item.priceUsd,
          currency: "usd",
          interval: item.kind === "plan" ? "month" : undefined,
          active: true,
          status: "synced",
          createdAt: now,
          updatedAt: now,
          error: archiveWarning || undefined
        });
        if (item.kind === "plan" && activeMapping) {
          const affected = next.billingSubscriptions.filter((subscription) => subscription.planId === item.id && (subscription.stripeMode || "test") === input.mode && !["canceled", "incomplete_expired"].includes(subscription.status)).length;
          next.billingStripeSubscriptionMigrations.push({
            id: id("smig"),
            mode: input.mode,
            planId: item.id,
            fromRevisionId: activeMapping.revisionId,
            toRevisionId: revisionId,
            policy: input.subscriptionPolicy || "new_customers_only",
            affectedSubscriptions: affected,
            status: "recorded",
            createdBy: input.actorId,
            createdAt: now,
            completedAt: now
          });
        }
        const profile = next.billingStripeConnections.find((entry) => entry.mode === input.mode);
        if (profile) {
          profile.catalogSyncedAt = now;
          profile.error = archiveWarning || undefined;
          profile.updatedAt = now;
        }
      });
      results.push({ itemId: item.id, name: item.name, status: "created", priceId: price.id, error: archiveWarning || undefined });
    } catch (error) {
      results.push({ itemId: item.id, name: item.name, status: "failed", error: error instanceof Error ? error.message : "Stripe catalogue synchronization failed." });
    }
  }

  const failed = results.filter((item) => item.status === "failed");
  await mutateDb((next) => {
    const profile = next.billingStripeConnections.find((entry) => entry.mode === input.mode);
    if (!profile) return;
    profile.catalogSyncedAt = new Date().toISOString();
    profile.error = failed.length ? `${failed.length} catalogue item(s) failed to synchronize.` : undefined;
    profile.updatedAt = new Date().toISOString();
  });
  return { ok: failed.length === 0, mode: input.mode, results };
}

function revisionMatches(revision: BillingStripeCatalogueRevision, item: CatalogueItem) {
  return revision.itemName === item.name
    && revision.amountUsd === item.priceUsd
    && revision.baseCredits === item.baseCredits
    && revision.bonusPercent === item.bonusPercent
    && revision.bonusCredits === bonusCredits(item)
    && revision.totalCredits === item.totalCredits
    && revision.expiryDays === expiryDays(item);
}

function toRevision(input: { revisionId: string; mode: StripeMode; item: CatalogueItem; productId: string; priceId: string; actorId: string; reason: string }): BillingStripeCatalogueRevision {
  return {
    id: input.revisionId,
    mode: input.mode,
    itemKind: input.item.kind,
    itemId: input.item.id,
    itemName: input.item.name,
    productId: input.productId,
    priceId: input.priceId,
    amountUsd: input.item.priceUsd,
    currency: "usd",
    interval: input.item.kind === "plan" ? "month" : undefined,
    baseCredits: input.item.baseCredits,
    bonusCredits: bonusCredits(input.item),
    bonusPercent: input.item.bonusPercent,
    totalCredits: input.item.totalCredits,
    expiryDays: expiryDays(input.item),
    effectiveAt: new Date().toISOString(),
    createdBy: input.actorId,
    reason: input.reason
  };
}

function bonusCredits(item: CatalogueItem) {
  return "bonusCredits" in item ? item.bonusCredits : Math.max(0, item.totalCredits - item.baseCredits);
}

function expiryDays(item: CatalogueItem) {
  return "expiryDays" in item ? item.expiryDays : item.expiresAfterDays;
}

function offerFingerprint(item: CatalogueItem) {
  return crypto.createHash("sha256").update(JSON.stringify({
    name: item.name,
    priceUsd: item.priceUsd,
    baseCredits: item.baseCredits,
    bonusPercent: item.bonusPercent,
    bonusCredits: bonusCredits(item),
    totalCredits: item.totalCredits,
    expiryDays: expiryDays(item),
    kind: item.kind
  })).digest("hex").slice(0, 24);
}

function operationKey(...parts: string[]) {
  return `ca:${parts.join(":")}`.slice(0, 240);
}
