"use client";

import { useCallback, useEffect, useState } from "react";

type CreditState = {
  credits: number | null;
  status: "loading" | "ready" | "missing" | "error";
  message: string;
};

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

export function useKieCredits() {
  const [state, setState] = useState<CreditState>({
    credits: null,
    status: "loading",
    message: "Checking Kie credits…",
  });

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, status: "loading" }));
    try {
      const response = await fetch("/api/drama/credits", { cache: "no-store" });
      const payload = (await response.json()) as {
        credits?: number;
        error?: string;
        message?: string;
      };
      if (response.ok && Number.isFinite(Number(payload.credits))) {
        setState({
          credits: Number(payload.credits),
          status: "ready",
          message: "Kie AI credit balance refreshed.",
        });
        return;
      }
      setState({
        credits: null,
        status: payload.error === "missing_credential" ? "missing" : "error",
        message: payload.message || "Kie AI credits are unavailable.",
      });
    } catch {
      setState({
        credits: null,
        status: "error",
        message: "Kie AI credits are unavailable.",
      });
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  const label =
    state.status === "ready" && state.credits !== null
      ? `${numberFormatter.format(state.credits)} credits`
      : state.status === "missing"
        ? "Add KIE key"
        : state.status === "loading"
          ? "Checking credits…"
          : "Credits unavailable";

  return { ...state, label, refresh };
}
