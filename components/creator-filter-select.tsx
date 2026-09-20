"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";

export default function CreatorFilterSelect({ label, accessibleLabel, value, defaultValue, options, onChange }: {
  label: string; accessibleLabel: string; value: string; defaultValue: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef({ text: "", time: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState({ above: false, height: 320 });
  const selected = Math.max(0, options.findIndex(option => option.value === value));

  const updatePlacement = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
      setOpen(false);
      return;
    }
    const below = window.innerHeight - rect.bottom - 16;
    const above = rect.top - 16;
    const useAbove = below < Math.min(320, options.length * 44 + 12) && above > below;
    setPlacement({ above: useAbove, height: Math.min(320, Math.max(44, useAbove ? above : below)) });
  }, [options.length]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", updatePlacement);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", updatePlacement);
    };
  }, [open, updatePlacement]);

  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  function show(index = selected) {
    updatePlacement();
    search.current = { text: "", time: 0 };
    setActive(index);
    setOpen(true);
  }

  function choose(index: number) {
    onChange(options[index].value);
    setOpen(false);
    trigger.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const key = event.key;
    if (key === "Tab") { setOpen(false); return; }
    if (key === "Escape") {
      if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(key)) {
      event.preventDefault();
      if (!open) { show(key === "Home" ? 0 : key === "End" ? options.length - 1 : selected); return; }
      if (key === "Enter" || key === " ") { choose(active); return; }
      setActive(key === "Home" ? 0 : key === "End" ? options.length - 1 : (active + (key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const text = (open && now - search.current.time < 700 ? search.current.text : "") + key.toLowerCase();
      const query = [...text].every(char => char === text[0]) ? text[0] : text;
      const start = open ? active : selected;
      const match = options.map((_, offset) => (start + offset + 1) % options.length).find(index => options[index].label.toLowerCase().startsWith(query));
      if (!open) show(match ?? selected);
      else if (match !== undefined) setActive(match);
      search.current = { text, time: now };
    }
  }

  return <div ref={root} className="creator-filter-dropdown" data-active={value !== defaultValue} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button ref={trigger} type="button" role="combobox" aria-label={accessibleLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} aria-activedescendant={open ? `${id}-${active}` : undefined} className="creator-filter-trigger" onClick={() => open ? setOpen(false) : show()} onKeyDown={onKeyDown}>
      <span className="creator-filter-label">{label}</span><span className="creator-filter-value">{options[selected].label}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && <ul id={id} role="listbox" aria-label={accessibleLabel} className="creator-filter-menu" data-above={placement.above} style={{ maxHeight: placement.height }}>
      {options.map((option, index) => <li id={`${id}-${index}`} key={option.value} role="option" aria-selected={value === option.value} data-highlighted={active === index} onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
        <span>{option.label}</span>{value === option.value && <Check size={16} aria-hidden="true" />}
      </li>)}
    </ul>}
  </div>;
}
