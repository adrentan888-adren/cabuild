"use client";

import { useLayoutEffect } from "react";

let handler: ((event: PopStateEvent) => void) | undefined;

export function subscribeHistoryGuard(callback: (event: PopStateEvent) => void) {
  handler = callback;
  return () => { if (handler === callback) handler = undefined; };
}

// Register once, before Next's passive router listener. A page-mounted listener
// can be removed by a synchronous route restoration before it receives popstate.
export default function HistoryGuard() {
  useLayoutEffect(() => {
    const onPopState = (event: PopStateEvent) => handler?.(event);
    window.addEventListener("popstate", onPopState, true);
    return () => window.removeEventListener("popstate", onPopState, true);
  }, []);
  return null;
}
