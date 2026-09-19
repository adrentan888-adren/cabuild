"use client";

export const CREDIT_REFRESH_EVENT = "cabuild:credits-changed";

export function notifyCreditUsage() {
  window.dispatchEvent(new Event(CREDIT_REFRESH_EVENT));
}

// Refresh after failed requests too: a provider may have charged before returning an error.
export async function generationFetch(input: RequestInfo | URL, init?: RequestInit) {
  try { return await fetch(input, init); }
  finally { notifyCreditUsage(); }
}
