"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, X } from "lucide-react";

type Notice = { message: string; kind: "success" | "error" };

export function useStatusToast() {
  const [toast, updateToast] = useState<Notice | null>(null);
  const setToast = useCallback((message: string | null, kind: Notice["kind"] = "success") => {
    updateToast(message ? { message, kind } : null);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => updateToast(null), toast.kind === "error" ? 30000 : 15000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  return { toast, setToast };
}

export default function StatusToast({ toast, onDismiss }: { toast: Notice | null; onDismiss: () => void }) {
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const notice = noticeRef.current;
    if (!notice || !toast) return;
    const reserveSpace = () => document.documentElement.style.setProperty("--status-notice-space", `${Math.ceil(notice.getBoundingClientRect().height) + 36}px`);
    reserveSpace();
    const observer = new ResizeObserver(reserveSpace);
    observer.observe(notice);
    return () => { observer.disconnect(); document.documentElement.style.removeProperty("--status-notice-space"); };
  }, [toast]);
  if (!toast) return null;
  const failed = toast.kind === "error";
  return (
    <div ref={noticeRef} className={`status-notice ${failed ? "is-error" : "is-success"}`} role={failed ? "alert" : "status"}>
      {failed ? <CircleAlert size={18} aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />}
      <div className="status-notice-message" tabIndex={failed ? 0 : undefined} aria-label={failed ? "Full failure message" : undefined}><b>{failed ? "Failed" : "Success"}</b><p>{toast.message}</p></div>
      <button type="button" onClick={onDismiss} aria-label="Dismiss notification"><X size={16} /></button>
    </div>
  );
}
