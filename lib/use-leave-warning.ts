"use client";

import { useCallback, useEffect, useRef } from "react";

// Includes Next-managed entries, so cancelled Back and Forward restore the correct direction.
export function browserHistoryIndex() {
  const index = (window as Window & { navigation?: { currentEntry?: { index: number } } }).navigation?.currentEntry?.index;
  return typeof index === "number" && index >= 0 ? index : undefined;
}

export function useLeaveWarning(active: boolean) {
  const activeRef = useRef(active);
  const approved = useRef(false);
  activeRef.current = active;
  const confirmLeave = useCallback(() => {
    if (!activeRef.current || approved.current) return true;
    const leave = window.confirm("Leave without saving? Your edits will be discarded. Your saved persona will stay unchanged.");
    if (leave) {
      approved.current = true;
      window.setTimeout(() => { approved.current = false; }, 0);
    }
    return leave;
  }, []);
  useEffect(() => {
    if (!active) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const click = (event: MouseEvent) => {
      const link = (event.target as Element)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download") || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const url = new URL(link.href);
      if (url.href === window.location.href || (url.pathname === location.pathname && url.search === location.search && url.hash)) return;
      if (!confirmLeave()) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", click, true); };
  }, [active, confirmLeave]);
  return confirmLeave;
}
