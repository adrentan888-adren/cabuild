"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/app", { cache: "no-store" })
      .then((res) => {
        if (!cancelled && res.ok) router.replace("/");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function submit(form: FormData) {
    setError("");
    setSubmitting(true);
    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form.entries()))
    });
    setSubmitting(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error || "Authentication failed");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  const isLogin = mode === "login";

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div>
          <div className="brand-mark">CA</div>
          <h1>ContentAgent Social</h1>
          <p>Intelligence-first content planning, production, and publishing for SME social channels.</p>
        </div>
        <form action={submit} className="auth-card">
          <div className="segmented">
            <button type="button" className={isLogin ? "on" : ""} onClick={() => router.push("/login")}>Sign in</button>
            <button type="button" className={!isLogin ? "on" : ""} onClick={() => router.push("/register")}>Create account</button>
          </div>
          {!isLogin && (
            <>
              <label>Name<input name="name" placeholder="Sean Tan" autoComplete="name" /></label>
              <label>Workspace<input name="workspaceName" placeholder="My Social Workspace" /></label>
              <label>Niche<input name="niche" placeholder="SME AI automation" /></label>
            </>
          )}
          <label>Email<input name="email" type="email" defaultValue={isLogin ? "demo@contentagent.tech" : ""} required autoComplete="email" /></label>
          <label>Password<input name="password" type="password" defaultValue={isLogin ? "demo1234" : ""} required autoComplete={isLogin ? "current-password" : "new-password"} /></label>
          {error && <div className="error">{error}</div>}
          <button className="primary" type="submit" disabled={submitting}>{submitting ? "Working..." : isLogin ? "Enter workspace" : "Create workspace"}</button>
        </form>
      </section>
    </main>
  );
}
