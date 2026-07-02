"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, RefreshCcw } from "lucide-react";
import AdminPanel from "./AdminPanel";
import type { AdminAppData, AdminUserData, IntegrationData } from "./AdminPanel";

async function post(action: string, payload: Record<string, unknown> = {}) {
  const res = await fetch("/api/social", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload })
  });
  if (!res.ok) throw new Error((await res.json()).error || "Request failed");
  return res.json();
}

export default function AdminClient() {
  const router = useRouter();
  const [data, setData] = useState<AdminAppData | null>(null);
  const [adminData, setAdminData] = useState<AdminUserData | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationData | null>(null);
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const res = await fetch("/api/app", { cache: "no-store" });
    if (res.status === 401 || res.status === 403) {
      router.replace("/login");
      return;
    }
    setData(await res.json());
    setLoading(false);
    fetch("/api/integrations", { cache: "no-store" })
      .then((health) => (health.ok ? health.json() : null))
      .then(setIntegrations)
      .catch(() => setIntegrations(null));
    fetch("/api/admin/users", { cache: "no-store" })
      .then((users) => (users.ok ? users.json() : null))
      .then(setAdminData)
      .catch(() => setAdminData(null));
  }

  useEffect(() => {
    refresh();
  }, []);

  async function run(action: string, payload: Record<string, unknown> = {}, message = "Updated") {
    try {
      const result = await post(action, payload);
      await refresh();
      setToast(message);
      return result;
    } catch (error) {
      await refresh();
      setToast(error instanceof Error ? error.message : "Action failed");
      return null;
    } finally {
      setTimeout(() => setToast(""), 2200);
    }
  }

  async function runAdmin(method: "POST" | "PATCH", payload: Record<string, unknown>, message = "Updated") {
    try {
      const res = await fetch("/api/admin/users", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error((await res.json()).error || "Admin request failed");
      await refresh();
      setToast(message);
      return await res.json();
    } catch (error) {
      await refresh();
      setToast(error instanceof Error ? error.message : "Admin request failed");
      return null;
    } finally {
      setTimeout(() => setToast(""), 2200);
    }
  }

  if (loading) return <div className="loading">Loading backend controls...</div>;
  if (!data) return <div className="loading">Redirecting to sign in...</div>;

  return (
    <div className="admin-shell">
      {toast && <div className="toast">{toast}</div>}
      <header className="admin-topbar">
        <a href="/" className="asset-link">Open frontend</a>
        <div className="topbar-right">
          <span className="credit-pill"><b>{data.user.name}</b> {data.user.role}</span>
          <button className="icon-btn" title="Refresh" onClick={refresh}><RefreshCcw size={15} /></button>
          <button className="icon-btn" title="Log out" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); }}><LogOut size={15} /></button>
        </div>
      </header>
      <main className="admin-main">
        <AdminPanel data={data} run={run} runAdmin={runAdmin} integrations={integrations} adminData={adminData} />
      </main>
    </div>
  );
}
