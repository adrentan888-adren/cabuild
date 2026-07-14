"use client";

import { AlertTriangle, CheckCircle2, Download, FileCheck2, RefreshCcw, Search } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { BillingFinanceCloseReport, BillingFinanceMetrics, BillingLedgerEntry, BillingReconciliationAlert, BillingReconciliationRun, BillingSettings, BillingStripeBalanceTransaction, StripeMode } from "@/lib/types";

type FinanceResponse = {
  filters: { from: string; to: string; mode: StripeMode };
  metrics: BillingFinanceMetrics;
  dataSource: string;
  metricDefinitions: readonly (readonly [string, string])[];
  quality: { synchronizedTransactions: number; unresolvedAlerts: number; lastReconciledAt?: string };
  revenueByType: { label: string; amountUsd: number }[];
  costsByProvider: { label: string; amountUsd: number }[];
  usageByModule: { label: string; credits: number }[];
  users: { userId: string; name: string; email: string; creditsPurchased: number; creditsUsed: number; providerCostUsd: number }[];
  transactions: BillingStripeBalanceTransaction[];
  ledger: BillingLedgerEntry[];
  alerts: BillingReconciliationAlert[];
  reconciliationRuns: BillingReconciliationRun[];
  closeReports: BillingFinanceCloseReport[];
  permissions: string[];
};

const metricCards: Array<[keyof BillingFinanceMetrics, string, "usd" | "percent" | "count"]> = [
  ["grossSalesUsd", "Gross sales", "usd"], ["refundsUsd", "Refunds", "usd"], ["netSalesUsd", "Net sales", "usd"],
  ["stripeFeesUsd", "Stripe fees", "usd"], ["netCashUsd", "Net cash", "usd"], ["providerCostUsd", "Provider cost", "usd"],
  ["grossMarginUsd", "Gross margin", "usd"], ["grossMarginPercent", "Margin rate", "percent"],
  ["faceValueLiabilityUsd", "Credit liability", "usd"], ["mrrUsd", "MRR", "usd"], ["activeSubscriptions", "Active subscriptions", "count"],
  ["creditsConsumed", "Credits consumed", "count"]
];

export default function FinanceManagement({ settings }: { settings: BillingSettings }) {
  const initialDates = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 29 * 86400_000);
    return { from: inputDate(from), to: inputDate(to) };
  }, []);
  const [mode, setMode] = useState<StripeMode>(settings.stripeMode === "live" ? "live" : "test");
  const [from, setFrom] = useState(initialDates.from);
  const [to, setTo] = useState(initialDates.to);
  const [data, setData] = useState<FinanceResponse | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setBusy("load"); setError("");
    try {
      const response = await fetch(`/api/admin/finance?${params()}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Finance report failed to load.");
      setData(json);
    } catch (next) { setError(next instanceof Error ? next.message : "Finance report failed to load."); }
    finally { setBusy(""); }
  }

  async function post(operation: string, payload: Record<string, unknown> = {}) {
    setBusy(operation); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/finance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation, mode, from: fromIso(from, false), to: fromIso(to, true), ...payload }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Finance action failed.");
      setMessage(operation === "reconcile" ? `Reconciliation completed with ${json.run?.alertsDetected || 0} finding(s).` : operation === "closePeriod" ? "Immutable close report created." : operation === "updateThresholds" ? "Finance alert thresholds saved." : "Finance finding updated.");
      await load();
    } catch (next) { setError(next instanceof Error ? next.message : "Finance action failed."); }
    finally { setBusy(""); }
  }

  function params(extra?: Record<string, string>) {
    return new URLSearchParams({ mode, from: fromIso(from, false), to: fromIso(to, true), ...extra }).toString();
  }

  async function updateAlert(alert: BillingReconciliationAlert, operation: "resolveAlert" | "ignoreAlert" | "reopenAlert") {
    const note = operation === "reopenAlert" ? "Reopened for investigation." : window.prompt("Add an audit note for this decision:", "Reviewed by finance admin.");
    if (note === null) return;
    await post(operation, { alertId: alert.id, note });
  }

  const permissions = new Set(data?.permissions || []);
  const openAlerts = data?.alerts.filter((item) => item.status === "open") || [];

  return (
    <div className="finance-page">
      <section className="card admin-card finance-toolbar">
        <div className="finance-title-row">
          <div><span className="clbl">Phase 12</span><h3>Finance and reconciliation</h3><p className="muted">Stripe accounting, credit liability, provider cost, discrepancy review, and immutable period closes.</p></div>
          <span className={`status ${openAlerts.length ? "pending" : "done"}`}>{openAlerts.length ? `${openAlerts.length} open findings` : "Reconciled"}</span>
        </div>
        <form className="finance-filter-grid" onSubmit={(event: FormEvent) => { event.preventDefault(); void load(); }}>
          <label>Environment<select value={mode} onChange={(event) => setMode(event.target.value as StripeMode)}><option value="test">Test</option><option value="live">Live</option></select></label>
          <label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <div className="finance-filter-actions"><button className="primary" disabled={Boolean(busy)}><Search size={14} />Apply</button><button type="button" disabled={Boolean(busy) || !permissions.has("finance.reconcile")} onClick={() => void post("reconcile")}><RefreshCcw size={14} className={busy === "reconcile" ? "spin" : ""} />{busy === "reconcile" ? "Reconciling..." : "Reconcile Stripe"}</button></div>
        </form>
        <div className="finance-quality"><span>Source: <b>{data?.dataSource === "stripe_balance_transactions" ? "Stripe balance transactions" : "Local ledger fallback"}</b></span><span>Synced: <b>{data?.quality.synchronizedTransactions || 0}</b></span><span>Last reconciliation: <b>{dateTime(data?.quality.lastReconciledAt)}</b></span></div>
        {message && <p className="provider-success"><CheckCircle2 size={15} />{message}</p>}
        {error && <p className="provider-error"><AlertTriangle size={15} />{error}</p>}
      </section>

      {data && <>
        <section className="finance-metric-grid">{metricCards.map(([key, label, format]) => <div className="finance-metric" key={key}><span>{label}</span><strong>{formatValue(data.metrics[key], format)}</strong></div>)}</section>

        <div className="finance-two-col">
          <section className="card admin-card"><div className="admin-card-head"><div><span className="clbl">Cash</span><h3>Revenue and cost</h3></div></div><div className="finance-breakdowns"><Breakdown title="Revenue" rows={data.revenueByType.map((item) => [item.label, usd(item.amountUsd)])} /><Breakdown title="Provider cost" rows={data.costsByProvider.map((item) => [item.label, usd(item.amountUsd)])} /><Breakdown title="Usage" rows={data.usageByModule.map((item) => [item.label, credits(item.credits)])} /></div></section>
          <section className="card admin-card"><div className="admin-card-head"><div><span className="clbl">Definitions</span><h3>How totals are calculated</h3></div></div><div className="finance-definition-list">{data.metricDefinitions.map(([label, definition]) => <div key={label}><b>{label}</b><span>{definition}</span></div>)}</div></section>
        </div>

        <section className="card admin-card"><div className="admin-card-head"><div><span className="clbl">Controls</span><h3>Finance alert thresholds</h3></div></div><form className="finance-threshold-grid" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post("updateThresholds", Object.fromEntries(form.entries())); }}><label>Minimum margin %<input name="financeMarginAlertPercent" type="number" min="0" max="100" step="0.1" defaultValue={settings.financeMarginAlertPercent ?? 20} /></label><label>Credit liability USD<input name="financeLiabilityAlertUsd" type="number" min="0" step="1" defaultValue={settings.financeLiabilityAlertUsd ?? 10000} /></label><label>High user spend USD<input name="financeHighSpendUserUsd" type="number" min="0" step="1" defaultValue={settings.financeHighSpendUserUsd ?? 500} /></label><label>Webhook failure window<input name="financeWebhookFailureHours" type="number" min="1" max="720" step="1" defaultValue={settings.financeWebhookFailureHours ?? 24} /></label><button className="primary" disabled={Boolean(busy) || !permissions.has("billing.manage")}>Save thresholds</button></form></section>

        <section className="card admin-card">
          <div className="admin-card-head"><div><span className="clbl">Exceptions</span><h3>Reconciliation findings</h3></div><span className="admin-pill">{data.alerts.length} total</span></div>
          <div className="finance-alert-list">{data.alerts.length ? data.alerts.map((alert) => <div className={`finance-alert ${alert.severity}`} key={alert.id}><AlertTriangle size={16} /><div><b>{alert.type.replace(/_/g, " ")}</b><span>{alert.message}</span><small>{dateTime(alert.lastDetectedAt)}{alert.stripeReference ? ` | ${alert.stripeReference}` : ""}{alert.resolutionNote ? ` | ${alert.resolutionNote}` : ""}</small></div><span className={`status ${alert.status === "open" ? "pending" : "done"}`}>{alert.status}</span><div className="row-actions">{alert.status === "open" ? <><button disabled={!permissions.has("finance.resolveAlerts")} onClick={() => void updateAlert(alert, "resolveAlert")}>Resolve</button><button disabled={!permissions.has("finance.resolveAlerts")} onClick={() => void updateAlert(alert, "ignoreAlert")}>Ignore</button></> : <button disabled={!permissions.has("finance.resolveAlerts")} onClick={() => void updateAlert(alert, "reopenAlert")}>Reopen</button>}</div></div>) : <div className="empty-state compact">No reconciliation findings for this Stripe environment.</div>}</div>
        </section>

        <div className="finance-two-col">
          <section className="card admin-card"><div className="admin-card-head"><div><span className="clbl">Users</span><h3>User cost audit</h3></div><a className="button-link" href={`/api/admin/finance/export?${params({ dataset: "users" })}`}><Download size={14} />CSV</a></div><div className="table-scroll"><table className="admin-user-table finance-table"><thead><tr><th>User</th><th>Purchased</th><th>Used</th><th>Provider cost</th></tr></thead><tbody>{data.users.map((user) => <tr key={user.userId}><td><b>{user.name}</b><small>{user.email}</small></td><td>{credits(user.creditsPurchased)}</td><td>{credits(user.creditsUsed)}</td><td>{usd(user.providerCostUsd)}</td></tr>)}{!data.users.length && <tr><td colSpan={4}>No user billing activity in this period.</td></tr>}</tbody></table></div></section>
          <section className="card admin-card"><div className="admin-card-head"><div><span className="clbl">Close</span><h3>Period close</h3></div><FileCheck2 size={18} /></div><p className="muted">Creates a hash-protected snapshot. It cannot be edited or replaced.</p><div className="row-actions"><button disabled={Boolean(busy) || !permissions.has("finance.close")} onClick={() => void post("closePeriod", { periodType: "daily" })}>Close selected day/range</button><button className="primary" disabled={Boolean(busy) || !permissions.has("finance.close")} onClick={() => void post("closePeriod", { periodType: "monthly" })}>Close month/range</button></div><div className="finance-close-list">{data.closeReports.slice(0, 6).map((close) => <div key={close.id}><b>{close.periodType} | {usd(close.metrics.netSalesUsd)} net sales</b><span>{dateTime(close.createdAt)} | {close.hash.slice(0, 12)}</span></div>)}{!data.closeReports.length && <div className="empty-state compact">No closed periods yet.</div>}</div></section>
        </div>

        <section className="card admin-card"><div className="admin-card-head"><div><span className="clbl">Trace</span><h3>Stripe balance transactions</h3></div><div className="row-actions"><a className="button-link" href={`/api/admin/finance/export?${params({ dataset: "summary" })}`}><Download size={14} />Summary</a><a className="button-link" href={`/api/admin/finance/export?${params({ dataset: "transactions" })}`}><Download size={14} />Transactions</a><a className="button-link" href={`/api/admin/finance/export?${params({ dataset: "ledger" })}`}><Download size={14} />Ledger</a><a className="button-link" href={`/api/admin/finance/export?${params({ dataset: "alerts" })}`}><Download size={14} />Findings</a></div></div><div className="table-scroll"><table className="admin-user-table finance-table"><thead><tr><th>Date</th><th>Reference</th><th>Category</th><th>Gross</th><th>Fee</th><th>Net</th></tr></thead><tbody>{data.transactions.map((item) => <tr key={item.id}><td>{dateTime(item.createdAt)}</td><td><code>{item.stripeBalanceTransactionId}</code><small>{item.paymentIntentId || item.sourceId}</small></td><td>{item.reportingCategory}<small>{item.status}</small></td><td>{usd(item.amountUsd)}</td><td>{usd(item.feeUsd)}</td><td>{usd(item.netUsd)}</td></tr>)}{!data.transactions.length && <tr><td colSpan={6}>Run reconciliation to synchronize Stripe accounting transactions.</td></tr>}</tbody></table></div></section>

        <section className="card admin-card"><div className="admin-card-head"><div><span className="clbl">Runs</span><h3>Reconciliation history</h3></div></div><div className="finance-run-list">{data.reconciliationRuns.map((run) => <div key={run.id}><span className={`status ${run.status === "completed" ? "done" : "failed"}`}>{run.status}</span><b>{run.mode} | {run.source}</b><span>{dateTime(run.completedAt)} | synced {run.syncedTransactions} | findings {run.alertsDetected}</span>{run.error && <small>{run.error}</small>}</div>)}{!data.reconciliationRuns.length && <div className="empty-state compact">No reconciliation runs yet.</div>}</div></section>
      </>}
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: string[][] }) { return <div><b>{title}</b>{rows.length ? rows.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>) : <span><small>No activity</small><strong>-</strong></span>}</div>; }
function formatValue(value: number, format: "usd" | "percent" | "count") { return format === "usd" ? usd(value) : format === "percent" ? `${Number(value || 0).toFixed(1)}%` : credits(value); }
function usd(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0)); }
function credits(value: number) { return Math.round(Number(value || 0)).toLocaleString(); }
function dateTime(value?: string) { return value ? new Date(value).toLocaleString() : "Not yet"; }
function inputDate(value: Date) { return value.toISOString().slice(0, 10); }
function fromIso(value: string, end: boolean) { const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}`); return date.toISOString(); }
