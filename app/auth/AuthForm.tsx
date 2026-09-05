"use client";
import { PageArtwork } from "@/components/page-intro";

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
      if (json.verificationRequired && json.email) {
        router.push(`/verify-email?email=${encodeURIComponent(json.email)}`);
        return;
      }
      setError(json.error || "Authentication failed");
      return;
    }
    const json = await res.json().catch(() => ({}));
    if (json.verificationRequired && json.email) {
      router.push(`/verify-email?email=${encodeURIComponent(json.email)}`);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  const isLogin = mode === "login";

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="auth-brand">
          <div className="brand-mark">CA</div>
          <h1>ContentAgent Social</h1>
          <p>Intelligence-first content planning, production, and publishing for SME social channels.</p>
          <PageArtwork kind="create" />
        </div>
        <form action={submit} className="auth-card">
          <div className="segmented">
            <button type="button" className={isLogin ? "on" : ""} onClick={() => router.push("/login")}>Sign in</button>
            <button type="button" className={!isLogin ? "on" : ""} onClick={() => router.push("/register")}>Create account</button>
          </div>
          <label>Email<input name="email" type="email" defaultValue={isLogin ? "demo@contentagent.tech" : ""} required autoComplete="email" /></label>
          <label>Password<input name="password" type="password" defaultValue={isLogin ? "demo1234" : ""} required autoComplete={isLogin ? "current-password" : "new-password"} /></label>
          {!isLogin && <label>Confirm password<input name="confirmPassword" type="password" required autoComplete="new-password" /></label>}
          {error && <div className="error">{error}</div>}
          <button className="primary" type="submit" disabled={submitting}>{submitting ? "Working..." : isLogin ? "Enter workspace" : "Create account"}</button>
        </form>
      </section>
    </main>
  );
}
