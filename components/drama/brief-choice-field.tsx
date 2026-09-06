"use client";

import { useId } from "react";

export default function BriefChoiceField({ label, value, options, optionSuffix = "", onChange }: {
  label: string; value: string; options: string[]; optionSuffix?: string; onChange: (value: string) => void;
}) {
  const name = useId();
  const numeric = label === "Number of episodes" || label === "Length per episode";
  const choices = options.includes(value) ? options : [...options, value];
  return <fieldset className={`brief-choices ${numeric ? "numeric-choices" : ""} ${label === "Aspect ratio" ? "ratio-choices" : ""}`}>
    <legend>{label}</legend>
    {numeric ? <div className="brief-slider-control">
      <output htmlFor={name}>{value}{optionSuffix || " episodes"}</output>
      <input id={name} aria-label={`Adjust ${label.toLowerCase()}`} type="range" min={0} max={choices.length - 1} step={1} list={`${name}-points`} value={choices.indexOf(value)} aria-valuetext={`${value}${optionSuffix || " episodes"}`} onChange={event => onChange(choices[Number(event.target.value)])} />
      <datalist id={`${name}-points`}>{choices.map((option, index) => <option key={option} value={index} label={`${option}${optionSuffix}`} />)}</datalist>
      <div className="brief-slider-points" aria-hidden="true">{choices.map((option, index) => <span key={option} className={value === option ? "selected" : ""} style={{ left: `${index / (choices.length - 1) * 100}%` }}><i />{option}{optionSuffix}</span>)}</div>
    </div> : <div className="brief-choice-options">{choices.map(option => <label key={option} className={value === option ? "selected" : ""}>
      <input type="radio" name={name} value={option} checked={value === option} onChange={() => onChange(option)} />
      {label === "Aspect ratio" && <span className="ratio-outline" aria-hidden="true" style={{ aspectRatio: option.replace(":", "/") }} />}
      <span>{option}{optionSuffix}</span>
    </label>)}</div>}
  </fieldset>;
}
