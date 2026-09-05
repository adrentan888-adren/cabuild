"use client";
import { PageArtwork } from "@/components/page-intro";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function VerifyEmailForm() {
  const router = useRouter();
  const params = useSearchParams();
  const initialEmail = params.get("email") || "";
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function verify() {
    setError("");
    setMessage("");
    setSubmitting(true);
    const res = await fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code })
    });
    setSubmitting(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error || "Could not verify email.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  async function resend() {
    setError("");
    setMessage("");
    const res = await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "Could not resend verification code.");
      return;
    }
    setMessage(json.alreadyVerified ? "This email is already verified. Please sign in." : "A new verification code has been sent.");
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="auth-brand">
          <div className="brand-mark">CA</div>
          <h1>Verify your email</h1>
          <p>Enter the 6-digit code we sent to your inbox. The code expires after 15 minutes.</p>
          <PageArtwork kind="create" />
        </div>
        <div className="auth-card">
          <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} required /></label>
          <label>Verification code<input inputMode="numeric" pattern="[0-9]*" maxLength={6} value={code} onChange={(event) => setCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" required /></label>
          {error && <div className="error">{error}</div>}
          {message && <div className="success-note">{message}</div>}
          <button className="primary" onClick={verify} disabled={submitting || code.length !== 6}>{submitting ? "Verifying..." : "Verify and enter app"}</button>
          <button className="ghost" onClick={resend}>Resend code</button>
          <button className="ghost" onClick={() => router.push("/login")}>Back to sign in</button>
        </div>
      </section>
    </main>
  );
}
