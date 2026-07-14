import { NextResponse } from "next/server";
import { buildFinanceReport, createFinanceClose, normalizeFinanceFilters, runStripeReconciliation } from "@/lib/finance";
import { hasPermission } from "@/lib/permissions";
import { currentUser } from "@/lib/session";
import { id, mutateDb, readDb } from "@/lib/store";
import type { Database, PermissionKey, StripeMode, User } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireFinance("finance.view");
  if ("error" in auth) return auth.error;
  return NextResponse.json({ ...buildFinanceReport(auth.db, queryFilters(req.url)), permissions: financePermissions(auth.db, auth.user) });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const operation = String(body.operation || "");
  if (operation === "reconcile") {
    const auth = await requireFinance("finance.reconcile");
    if ("error" in auth) return auth.error;
    const filters = normalizeFinanceFilters({ from: String(body.from || ""), to: String(body.to || ""), mode: parseMode(body.mode) });
    try {
      const run = await runStripeReconciliation({ ...filters, source: "manual", initiatedBy: auth.user.id });
      await mutateDb((db) => audit(db, auth.user, `Stripe ${filters.mode} finance reconciliation completed.`, { operation, runId: run.id, alertsDetected: run.alertsDetected }));
      const db = await readDb();
      return NextResponse.json({ ok: true, run, ...buildFinanceReport(db, filters), permissions: financePermissions(db, auth.user) });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Reconciliation failed." }, { status: 502 });
    }
  }
  if (["resolveAlert", "ignoreAlert", "reopenAlert"].includes(operation)) {
    const auth = await requireFinance("finance.resolveAlerts");
    if ("error" in auth) return auth.error;
    const alertId = String(body.alertId || "");
    const note = String(body.note || "").trim();
    if (!alertId) return NextResponse.json({ error: "Alert ID is required." }, { status: 400 });
    const result = await mutateDb((db) => {
      const alert = db.billingReconciliationAlerts.find((item) => item.id === alertId);
      if (!alert) return { error: "Alert not found.", status: 404 as const };
      alert.status = operation === "reopenAlert" ? "open" : operation === "ignoreAlert" ? "ignored" : "resolved";
      alert.resolvedAt = alert.status === "open" ? undefined : new Date().toISOString();
      alert.resolvedBy = alert.status === "open" ? undefined : auth.user.id;
      alert.resolutionNote = note || (alert.status === "open" ? "Reopened for review." : `Marked ${alert.status} by finance admin.`);
      audit(db, auth.user, `Finance alert ${alert.id} marked ${alert.status}.`, { operation, alertId, note });
      return { alert };
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, ...result });
  }
  if (operation === "closePeriod") {
    const auth = await requireFinance("finance.close");
    if ("error" in auth) return auth.error;
    const mode = parseMode(body.mode);
    const periodType = body.periodType === "daily" ? "daily" : "monthly";
    try {
      const close = await mutateDb((db) => {
        const next = createFinanceClose(db, { periodType, mode, from: String(body.from || ""), to: String(body.to || ""), createdBy: auth.user.id });
        audit(db, auth.user, `Closed ${mode} ${periodType} finance period.`, { operation, closeId: next.id, hash: next.hash });
        return next;
      });
      return NextResponse.json({ ok: true, close });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Could not close period." }, { status: 409 });
    }
  }
  if (operation === "updateThresholds") {
    const auth = await requireFinance("billing.manage");
    if ("error" in auth) return auth.error;
    const settings = await mutateDb((db) => {
      db.billingSettings.financeMarginAlertPercent = bounded(body.financeMarginAlertPercent, 0, 100, 20);
      db.billingSettings.financeLiabilityAlertUsd = bounded(body.financeLiabilityAlertUsd, 0, 1_000_000_000, 10000);
      db.billingSettings.financeHighSpendUserUsd = bounded(body.financeHighSpendUserUsd, 0, 1_000_000_000, 500);
      db.billingSettings.financeWebhookFailureHours = bounded(body.financeWebhookFailureHours, 1, 720, 24);
      audit(db, auth.user, "Updated finance alert thresholds.", { operation, settings: db.billingSettings });
      return db.billingSettings;
    });
    return NextResponse.json({ ok: true, settings });
  }
  return NextResponse.json({ error: "Unsupported finance operation." }, { status: 400 });
}

async function requireFinance(permission: PermissionKey) {
  const user = await currentUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const db = await readDb();
  if (user.disabledAt || !hasPermission(db, user, "admin.access") || !hasPermission(db, user, permission)) return { error: NextResponse.json({ error: "Finance permission required." }, { status: 403 }) };
  return { user, db };
}

function queryFilters(url: string) {
  const query = new URL(url).searchParams;
  return { from: query.get("from") || "", to: query.get("to") || "", mode: parseMode(query.get("mode")), userId: query.get("userId") || "", module: query.get("module") || "", provider: query.get("provider") || "", query: query.get("query") || "" };
}

function financePermissions(db: Database, user: User) {
  const keys: PermissionKey[] = ["finance.view", "finance.reconcile", "finance.export", "finance.close", "finance.resolveAlerts", "billing.manage"];
  return keys.filter((key) => hasPermission(db, user, key));
}

function parseMode(value: unknown): StripeMode { return value === "live" ? "live" : "test"; }
function bounded(value: unknown, min: number, max: number, fallback: number) { const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback; }
function audit(db: Database, user: User, message: string, details: Record<string, unknown>) {
  const now = new Date().toISOString();
  db.activity.push({ id: id("act"), workspaceId: user.workspaceId, message, createdAt: now });
  db.debugLogs.push({ id: id("log"), workspaceId: user.workspaceId, action: "adminFinance", label: message, status: "success", provider: "system", details, createdAt: now });
}
