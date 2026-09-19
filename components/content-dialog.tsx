"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export default function ContentDialog({ title, description, onClose, busy = false, children, compact = false }: {
  title: string; description?: string; onClose: () => void; busy?: boolean; children: ReactNode; compact?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      const target = opener?.isConnected ? opener : opener?.id ? document.getElementById(opener.id) : null;
      target?.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className={`content-dialog${compact ? " content-dialog-compact" : ""}`} aria-labelledby={titleId} aria-busy={busy}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget || busy) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <header className="content-dialog-head"><div><h2 id={titleId}>{title}</h2>{description && <p>{description}</p>}</div>
      <button type="button" className="icon-btn" aria-label={`Close ${title}`} disabled={busy} onClick={onClose}><X size={20} /></button>
    </header>
    <div className="content-dialog-body">{children}</div>
  </dialog>;
}
