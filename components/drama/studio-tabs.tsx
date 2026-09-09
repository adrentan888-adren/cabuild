"use client";

import { useId, useRef, type ReactNode } from "react";

export type StudioTab = {
  id: string;
  label: string;
  status?: string;
  tone?: "ready" | "generating" | "failed" | "pending";
};

/** Local, instant navigation. Selection never triggers generation or moves focus on progress updates. */
export default function StudioTabs({ label, value, onChange, items, children }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  items: StudioTab[];
  children: ReactNode;
}) {
  const id = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = items.findIndex(item => item.id === value);
  const active = selected < 0 ? 0 : selected;
  if (!items.length) return <div className="studio-tabs-empty">{children}</div>;
  return <div className="studio-tabs">
    <div className="studio-tablist" role="tablist" aria-label={label}>
      {items.map((item, index) => <button key={item.id} type="button" ref={node => { buttons.current[index] = node; }}
        id={`${id}-tab-${index}`} role="tab" aria-selected={index === active} aria-controls={`${id}-panel-${index}`}
        tabIndex={index === active ? 0 : -1} className={`studio-tab ${index === active ? "selected" : ""}`}
        onClick={() => onChange(item.id)} onKeyDown={event => {
          let next: number;
          if (event.key === "ArrowRight") next = (index + 1) % items.length;
          else if (event.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = items.length - 1;
          else return;
          event.preventDefault();
          onChange(items[next].id);
          buttons.current[next]?.focus();
        }}>
        <span className="studio-tab-label">{item.label}</span>
        {item.status && <span className={`studio-tab-status ${item.tone || "pending"}`}><i aria-hidden="true" />{item.status}</span>}
      </button>)}
    </div>
    {items.map((item, index) => <div key={item.id} id={`${id}-panel-${index}`} role="tabpanel"
      aria-labelledby={`${id}-tab-${index}`} hidden={index !== active} tabIndex={0} className="studio-tab-panel">
      {index === active ? children : null}
    </div>)}
  </div>;
}
