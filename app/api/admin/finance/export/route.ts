import { buildFinanceReport } from "@/lib/finance";
import { hasPermission } from "@/lib/permissions";
import { currentUser } from "@/lib/session";
import { id, mutateDb, readDb } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = await readDb();
  if (!hasPermission(db, user, "admin.access") || !hasPermission(db, user, "finance.export")) return Response.json({ error: "Finance export permission required." }, { status: 403 });
  const query = new URL(req.url).searchParams;
  const dataset = query.get("dataset") || "transactions";
  const report = buildFinanceReport(db, { from: query.get("from") || "", to: query.get("to") || "", mode: query.get("mode") === "live" ? "live" : "test" });
  const rows = csvRows(dataset, report);
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  await mutateDb((next) => {
    const now = new Date().toISOString();
    next.activity.push({ id: id("act"), workspaceId: user.workspaceId, message: `Exported finance ${dataset} CSV.`, createdAt: now });
    next.debugLogs.push({ id: id("log"), workspaceId: user.workspaceId, action: "adminFinanceExport", label: `Exported finance ${dataset} CSV.`, status: "success", provider: "system", details: { dataset, mode: report.filters.mode, from: report.filters.from, to: report.filters.to, rows: Math.max(0, rows.length - 1) }, createdAt: now });
  });
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="contentagent-finance-${dataset}-${report.filters.mode}.csv"`, "Cache-Control": "no-store" } });
}

function csvRows(dataset: string, report: ReturnType<typeof buildFinanceReport>): Array<Array<unknown>> {
  if (dataset === "ledger") return [["created_at", "id", "user_id", "module", "provider", "action", "type", "status", "credits", "usd_cost", "description"], ...report.ledger.map((item) => [item.createdAt, item.id, item.userId, item.module, item.provider, item.action, item.type, item.status, item.credits, item.usdCost, item.description])];
  if (dataset === "alerts") return [["detected_at", "last_detected_at", "id", "mode", "type", "severity", "status", "amount_usd", "order_id", "stripe_reference", "message"], ...report.alerts.map((item) => [item.detectedAt, item.lastDetectedAt, item.id, item.mode, item.type, item.severity, item.status, item.amountUsd, item.orderId, item.stripeReference, item.message])];
  if (dataset === "users") return [["user_id", "name", "email", "credits_purchased", "credits_used", "provider_cost_usd"], ...report.users.map((item) => [item.userId, item.name, item.email, item.creditsPurchased, item.creditsUsed, item.providerCostUsd])];
  if (dataset === "summary") return [["metric", "value"], ...Object.entries(report.metrics).map(([key, value]) => [key, value])];
  return [["created_at", "id", "mode", "type", "reporting_category", "amount_usd", "fee_usd", "net_usd", "currency", "status", "source_id", "payment_intent_id"], ...report.transactions.map((item) => [item.createdAt, item.stripeBalanceTransactionId, item.mode, item.type, item.reportingCategory, item.amountUsd, item.feeUsd, item.netUsd, item.currency, item.status, item.sourceId, item.paymentIntentId])];
}

function csvCell(value: unknown) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }
