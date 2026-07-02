"use client";

import { LogOut, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";

export default function AdminAccessDenied() {
  const router = useRouter();

  async function switchAccount() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <main className="admin-access-shell">
      <section className="admin-access-card">
        <div className="admin-access-icon"><ShieldAlert size={22} /></div>
        <div>
          <div className="clbl">Admin</div>
          <h1>Backend access only</h1>
          <p>
            This URL is the backend admin surface, but your current signed-in account is a normal frontend user.
            Sign in with an owner or admin account to manage prompt templates, providers, and backend settings.
          </p>
        </div>
        <button className="primary" onClick={switchAccount}><LogOut size={15} />Switch account</button>
        <a className="asset-link" href="/">Return to frontend</a>
      </section>
    </main>
  );
}
