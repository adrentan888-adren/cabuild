"use client";
import type { ReactNode } from "react";

export function AspectRatioIcon({ value }: { value: string }) {
  const [width, height] = value.split(":").map(Number);
  return <span className="creator-ratio-outline" aria-hidden="true" style={{ width: Math.min(24, 19 * width / height), height: Math.min(19, 24 * height / width) }} />;
}

export default function ChoiceButtons({ label, name, value, options, onChange }: {
  label: string; name?: string; value: string;
  options: Array<{ value: string; label: string; icon?: ReactNode }>;
  onChange: (value: string) => void;
}) {
  return <fieldset className="choice-buttons"><legend>{label}</legend>
    {name && <input type="hidden" name={name} value={value} />}
    <div>{options.map(option => <button type="button" key={option.value} aria-pressed={value === option.value} className={value === option.value ? "on" : ""} onClick={() => onChange(option.value)}>{option.icon && <span className="choice-icon" aria-hidden="true">{option.icon}</span>}{option.label}</button>)}</div>
  </fieldset>;
}
