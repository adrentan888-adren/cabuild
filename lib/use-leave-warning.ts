"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Includes Next-managed entries, so cancelled Back and Forward restore the correct direction.
export function browserHistoryIndex() {
  const index = (window as Window & { navigation?: { currentEntry?: { index: number } } }).navigation?.currentEntry?.index;
  return typeof index === "number" && index >= 0 ? index : undefined;
}

export function useLeaveWarning(active: boolean) {
  const activeRef = useRef(active);
  const approved = useRef(false);
  const pending = useRef<{ promise: Promise<boolean>; resolve: (leave: boolean) => void } | null>(null);
  const [open, setOpen] = useState(false);
  activeRef.current = active;
  const shouldWarn = useCallback(() => activeRef.current && !approved.current, []);
  const confirmLeave = useCallback(() => {
    if (!activeRef.current || approved.current) return Promise.resolve(true);
    if (pending.current) return pending.current.promise;
    let resolve!: (leave: boolean) => void;
    const promise = new Promise<boolean>(done => { resolve = done; });
    pending.current = { promise, resolve };
    setOpen(true);
    return promise;
  }, []);
  const answerLeave = useCallback((leave: boolean) => {
    const request = pending.current;
    pending.current = null;
    setOpen(false);
    request?.resolve(leave);
  }, []);
  useEffect(() => () => { pending.current?.resolve(false); pending.current = null; }, []);
  useEffect(() => {
    if (!active) return;
    const unload = (event: BeforeUnloadEvent) => { if (approved.current) return; event.preventDefault(); event.returnValue = ""; };
    const click = (event: MouseEvent) => {
      const link = (event.target as Element)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download") || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const url = new URL(link.href);
      if (url.href === window.location.href || (url.pathname === location.pathname && url.search === location.search && url.hash)) return;
      if (!shouldWarn()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void confirmLeave().then(leave => {
        if (!leave || !link.isConnected) return;
        approved.current = true;
        link.click();
        window.setTimeout(() => { approved.current = false; }, 0);
      });
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", click, true); };
  }, [active, confirmLeave, shouldWarn]);
  return { confirmLeave, shouldWarn, open, answerLeave };
}
