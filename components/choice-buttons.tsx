"use client";

export default function ChoiceButtons({ label, name, value, options, onChange }: {
  label: string; name?: string; value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return <fieldset className="choice-buttons"><legend>{label}</legend>
    {name && <input type="hidden" name={name} value={value} />}
    <div>{options.map(option => <button type="button" key={option.value} aria-pressed={value === option.value} className={value === option.value ? "on" : ""} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>
  </fieldset>;
}
