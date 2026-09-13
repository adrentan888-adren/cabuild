"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./studio-tab-status.css";

type StudioStatusTone = "ready" | "generating" | "failed" | "pending";

export type StudioTabStatusDetail = {
  label: string;
  status: string;
  tone?: StudioStatusTone;
  category?: string;
};

export type StudioTab = {
  id: string;
  label: string;
  status?: string;
  tone?: StudioStatusTone;
  statusDetails?: StudioTabStatusDetail[];
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
  const tooltip = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [position, setPosition] = useState({ left: 12, top: 12, maxHeight: 400 });
  const detailIndex = items.findIndex(item => item.id === detailId);
  const detailItem = items[detailIndex];
  const tooltipId = `${id}-status-details`;
  const keepDetails = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const closeDetails = () => {
    keepDetails();
    setDetailId(null);
  };
  const leaveDetails = () => {
    keepDetails();
    closeTimer.current = setTimeout(() => setDetailId(null), 150);
  };
  const showDetails = (item: StudioTab) => {
    keepDetails();
    setDetailId(item.statusDetails?.length ? item.id : null);
  };
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);
  useEffect(() => {
    if (!detailId) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailId(null);
    };
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!tooltip.current?.contains(target) && !buttons.current.some(button => button?.contains(target))) setDetailId(null);
    };
    document.addEventListener("keydown", dismiss);
    document.addEventListener("pointerdown", dismissOutside);
    return () => {
      document.removeEventListener("keydown", dismiss);
      document.removeEventListener("pointerdown", dismissOutside);
    };
  }, [detailId]);
  useLayoutEffect(() => {
    if (!detailItem?.statusDetails?.length) return;
    const place = () => {
      const anchor = buttons.current[detailIndex]?.getBoundingClientRect();
      const panel = tooltip.current?.getBoundingClientRect();
      if (!anchor || !panel) return;
      const margin = 12;
      const below = anchor.bottom + 8;
      const belowSpace = Math.max(0, window.innerHeight - margin - below);
      const aboveSpace = Math.max(0, anchor.top - margin - 8);
      const naturalHeight = tooltip.current!.scrollHeight + 2;
      const placeBelow = belowSpace >= naturalHeight || belowSpace >= aboveSpace;
      const maxHeight = Math.max(40, placeBelow ? belowSpace : aboveSpace);
      const top = placeBelow ? below : Math.max(margin, anchor.top - Math.min(naturalHeight, maxHeight) - 8);
      const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - panel.width - margin));
      setPosition(current => current.left === left && current.top === top && current.maxHeight === maxHeight ? current : { left, top, maxHeight });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const observer = new ResizeObserver(place);
    if (tooltip.current) observer.observe(tooltip.current);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      observer.disconnect();
    };
  }, [detailIndex, detailItem]);
  const selected = items.findIndex(item => item.id === value);
  const active = selected < 0 ? 0 : selected;
  if (!items.length) return <div className="studio-tabs-empty">{children}</div>;
  return <div className="studio-tabs">
    <div className="studio-tablist" role="tablist" aria-label={label}>
      {items.map((item, index) => <button key={item.id} type="button" ref={node => { buttons.current[index] = node; }}
        id={`${id}-tab-${index}`} role="tab" aria-selected={index === active} aria-controls={`${id}-panel-${index}`}
        aria-describedby={detailId === item.id && item.statusDetails?.length ? tooltipId : undefined}
        tabIndex={index === active ? 0 : -1} className={`studio-tab ${index === active ? "selected" : ""}`}
        onMouseEnter={() => showDetails(item)} onMouseLeave={leaveDetails}
        onFocus={() => showDetails(item)} onBlur={closeDetails}
        onClick={() => onChange(item.id)} onKeyDown={event => {
          if (event.key === "Escape") { closeDetails(); return; }
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
    {detailItem?.statusDetails?.length ? createPortal(<div ref={tooltip} id={tooltipId} role="tooltip"
      className="studio-tab-status-tooltip" style={position}
      onMouseEnter={keepDetails} onMouseLeave={leaveDetails}>
      <strong className="studio-tab-status-tooltip-title">{detailItem.label}</strong>
      <div className="studio-tab-status-detail-list">
        {detailItem.statusDetails.map((detail, index, details) => <div key={`${detail.category || ""}-${detail.label}-${index}`}>
          {detail.category && detail.category !== details[index - 1]?.category && <div className="studio-tab-status-category">{detail.category}</div>}
          <div className="studio-tab-status-detail-row">
            <span>{detail.label}</span>
            <span className={`studio-tab-status-detail-value ${detail.tone || "pending"}`}><i aria-hidden="true" />{detail.status}</span>
          </div>
        </div>)}
      </div>
    </div>, document.body) : null}
  </div>;
}
