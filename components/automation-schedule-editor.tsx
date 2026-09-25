"use client";

import { useEffect, useId, useState } from "react";
import { CalendarDays, CalendarCheck, Check, Clock3, FileText, Globe, Layers, Minus, Plus, Repeat2, Send, ShieldCheck, Sparkles } from "lucide-react";
import type { AutomationRule, AutomationSourceWatcher } from "@/lib/types";
import AutomationSelect from "./automation-select";

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const fullDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const policies = [
  { value: "draft-only", title: "Save a draft", detail: "Prepare an idea and prompt. You choose when to generate the media.", Icon: FileText, outcome: "Prepare draft → Your review → Generate when ready" },
  { value: "generate-and-wait", title: "Generate for review", detail: "Create the content, then wait for your approval before publishing.", Icon: ShieldCheck, outcome: "Generate content → Your approval → Ready to publish" },
  { value: "auto-schedule", title: "Generate and schedule", detail: "Create content and put it in the scheduled queue without manual approval.", Icon: CalendarCheck, outcome: "Generate content → Scheduled queue" },
  { value: "auto-publish", title: "Publish automatically", detail: "Create content and publish through your connected accounts when ready.", Icon: Send, outcome: "Generate content → Publish when ready" },
] as const;

export default function AutomationScheduleEditor({ initial, scheduled = false }: { initial?: AutomationRule | AutomationSourceWatcher; scheduled?: boolean }) {
  const [frequency, setFrequency] = useState(initial?.frequency || (scheduled ? "weekly" : "daily"));
  const [selectedDays, setSelectedDays] = useState(initial?.postingDays?.length ? initial.postingDays : ["Mon", "Wed", "Fri"]);
  const [time, setTime] = useState(initial?.postingTime || "10:00");
  const [timezone, setTimezone] = useState(initial?.timezone || "Asia/Kuala_Lumpur");
  const [zones, setZones] = useState([timezone, "Asia/Singapore", "UTC", "Europe/London", "America/New_York"]);
  const [approval, setApproval] = useState(initial?.approvalMode || "draft-only");
  const [quantity, setQuantity] = useState(initial && "quantityPerRun" in initial ? initial.quantityPerRun : 1);
  const timeId = useId();
  useEffect(() => {
    const available = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") || [];
    setZones(Array.from(new Set([timezone, "UTC", ...available])).sort());
  }, [timezone]);
  const activeDays = frequency === "daily" ? days : days.filter(day => selectedDays.includes(day));
  const hour = Number(time.split(":")[0]);
  const displayTime = time ? `${hour % 12 || 12}:${time.split(":")[1]} ${hour < 12 ? "AM" : "PM"}` : "Choose a time";
  const policy = policies.find(item => item.value === approval)!;
  return <section className="create-card automation-schedule-editor">
    <div className="optional-brief-heading"><CalendarDays size={22}/><h2>Schedule and publishing</h2></div>
    <p className="step-helper">Build a rhythm for your content, then choose how much you want to review.</p>
    <div className="automation-schedule-block">
      <div className="automation-section-label"><Repeat2 size={19}/><h3>When should it run?</h3></div>
      <fieldset className="choice-buttons automation-frequency"><legend>Repeat</legend><input type="hidden" name="frequency" value={frequency}/><div>
        {([{value:"daily",label:"Every day"},{value:"weekly",label:"Every week"},{value:"custom",label:"Choose days"}] as const).map(option=><button type="button" key={option.value} className={frequency===option.value?"on":""} aria-pressed={frequency===option.value} onClick={()=>setFrequency(option.value)}>{option.label}</button>)}
      </div></fieldset>
      <fieldset className="automation-days"><legend>{frequency==="daily"?"Runs every day":"Run on these days"}</legend><div>
        {days.map((day,index)=><button type="button" key={day} aria-label={fullDays[index]} aria-pressed={activeDays.includes(day)} className={activeDays.includes(day)?"on":""} disabled={frequency==="daily"} onClick={()=>setSelectedDays(current=>current.includes(day)?current.length>1?current.filter(item=>item!==day):current:[...current,day])}><span>{day}</span><Check size={14} aria-hidden="true"/></button>)}
      </div>{selectedDays.map(day=><input key={day} type="hidden" name="postingDays" value={day}/>)}</fieldset>
      {frequency!=="daily"&&<div className="automation-day-presets"><button type="button" onClick={()=>setSelectedDays(days.slice(0,5))}>Weekdays</button><button type="button" onClick={()=>setSelectedDays(days.slice(5))}>Weekends</button><small>Keep at least one day selected.</small></div>}
      <div className="automation-time-row">
        <label htmlFor={timeId}><span><Clock3 size={18}/>Start time</span><input id={timeId} name="postingTime" type="time" required value={time} onChange={event=>setTime(event.target.value)}/><small>Content generation starts at this time.</small></label>
        <div className="automation-timezone"><span><Globe size={18}/>Timezone</span><AutomationSelect label="Timezone" name="timezone" value={timezone} onValueChange={setTimezone}>{zones.map(zone=><option key={zone} value={zone}>{zone.replaceAll("_"," ").replaceAll("/"," / ")}</option>)}</AutomationSelect><small>Your schedule follows this timezone, including daylight saving.</small></div>
      </div>
      {scheduled&&<div className="automation-quantity"><div><h3><Layers size={18}/>Content per run</h3><p>Choose how many ideas to create each time.</p></div><div className="automation-stepper"><button type="button" aria-label="Fewer contents per run" disabled={quantity<=1} onClick={()=>setQuantity(value=>Math.max(1,value-1))}><Minus size={18}/></button><output aria-live="polite">{quantity}</output><input type="hidden" name="quantityPerRun" value={quantity}/><button type="button" aria-label="More contents per run" disabled={quantity>=5} onClick={()=>setQuantity(value=>Math.min(5,value+1))}><Plus size={18}/></button></div></div>}
    </div>
    <fieldset className="automation-publishing"><legend><ShieldCheck size={19}/>What happens after each run?</legend><p>Choose a review step or let the automation continue for you.</p><input type="hidden" name="approvalMode" value={approval}/><div className="automation-policy-grid">
      {policies.map(({value,title,detail,Icon})=><button type="button" key={value} aria-pressed={approval===value} className={approval===value?"on":""} onClick={()=>setApproval(value)}><Icon size={23}/><span><b>{title}</b><small>{detail}</small></span><span className="automation-policy-check" aria-hidden="true">{approval===value&&<Check size={14}/>}</span></button>)}
    </div></fieldset>
    <div className="automation-schedule-preview" role="status"><span className="automation-preview-icon"><Sparkles size={24}/></span><div><small>Your schedule at a glance</small><strong>{frequency==="daily"?"Every day":activeDays.join(", ")} at {displayTime}</strong><span>{timezone.replaceAll("_"," ")}{scheduled?` · ${quantity} ${quantity===1?"idea":"ideas"} per run`:" · Monitor your sources"}</span><p>{policy.outcome}</p></div></div>
  </section>;
}
