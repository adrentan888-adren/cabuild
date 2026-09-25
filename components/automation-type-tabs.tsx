"use client";
import { CalendarDays, Radar } from "lucide-react";

export type AutomationKind = "sources" | "scheduled";
export default function AutomationTypeTabs({ value, onChange, counts, disabled=false }: {
  value:AutomationKind; onChange:(value:AutomationKind)=>void; counts?:Record<AutomationKind,number>; disabled?:boolean;
}) {
  return <nav className="automation-type-tabs" aria-label="Automation type">
    {([{value:"sources",label:"Monitor sources",description:"Find content from your chosen accounts",Icon:Radar},{value:"scheduled",label:"Scheduled content",description:"Create from your instructions on a schedule",Icon:CalendarDays}] as const).map(type=><button type="button" key={type.value} aria-pressed={value===type.value} className={value===type.value?"on":""} disabled={disabled} onClick={()=>onChange(type.value)}>
      <type.Icon size={23} aria-hidden="true"/><span><b>{type.label}</b><small>{type.description}</small></span>{counts&&<span className="automation-type-count" aria-label={`${counts[type.value]} saved`}>{counts[type.value]}</span>}
    </button>)}
  </nav>;
}
