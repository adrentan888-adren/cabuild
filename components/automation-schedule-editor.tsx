"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CalendarDays, CalendarCheck, Check, Clock3, FileText, Globe, Layers, Minus, Plus, Repeat2, Send, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import type { AutomationRule, AutomationSourceWatcher } from "@/lib/types";
import { calendarDateInZone, scheduleTimes } from "@/lib/automation-schedule";
import AutomationSelect from "./automation-select";

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const fullDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const policies = [
  { value: "draft-only", title: "Save a draft", detail: "Prepare an idea and prompt. You choose when to generate the media.", Icon: FileText, outcome: "Prepare draft → Your review → Generate when ready" },
  { value: "generate-and-wait", title: "Generate for review", detail: "Create the content, then wait for your approval before publishing.", Icon: ShieldCheck, outcome: "Generate content → Your approval → Ready to publish" },
  { value: "auto-schedule", title: "Generate and schedule", detail: "Create content and put it in the scheduled queue without manual approval.", Icon: CalendarCheck, outcome: "Generate content → Scheduled queue" },
  { value: "auto-publish", title: "Publish automatically", detail: "Create content and publish through your connected accounts when ready.", Icon: Send, outcome: "Generate content → Publish when ready" },
] as const;

function useScheduleDraft(initial?:AutomationRule|AutomationSourceWatcher) {
 const [frequency,setFrequency]=useState(initial?.frequency==='daily'||initial?.frequency==='interval'?'interval':'weekly');
 const [selectedDays,setSelectedDays]=useState(initial?.postingDays?.length?initial.postingDays:['Mon','Wed','Fri']);
 const [times,setTimes]=useState(()=>scheduleTimes(initial||{postingTime:'10:00'}).map((time,id)=>({id,time})));
 const nextTimeId=useRef(times.length);
 const [intervalDays,setIntervalDays]=useState(String(initial?.intervalDays||1));
 const [startDate,setStartDate]=useState(initial?.scheduleStartDate||'');
 const startDateInitialized=useRef(false);
 const [timezone,setTimezone]=useState(initial?.timezone||'Asia/Kuala_Lumpur');
 const [zones,setZones]=useState([timezone,'Asia/Singapore','UTC','Europe/London','America/New_York']);
 const [approval,setApproval]=useState(initial?.approvalMode||'draft-only');
 const [quantity,setQuantity]=useState(initial&&'quantityPerRun' in initial?initial.quantityPerRun:1);
 useEffect(()=>{const available=(Intl as typeof Intl & {supportedValuesOf?:(key:string)=>string[]}).supportedValuesOf?.('timeZone')||[];setZones(Array.from(new Set([timezone,'UTC',...available])).sort());if(!startDateInitialized.current){startDateInitialized.current=true;if(!startDate)setStartDate(calendarDateInZone(timezone));}},[timezone,startDate]);
 return {frequency,setFrequency,selectedDays,setSelectedDays,times,setTimes,nextTimeId,intervalDays,setIntervalDays,startDate,setStartDate,timezone,setTimezone,zones,approval,setApproval,quantity,setQuantity};
}
const ScheduleContext=createContext<ReturnType<typeof useScheduleDraft>|null>(null);
export function AutomationScheduleProvider({initial,children}:{initial?:AutomationRule|AutomationSourceWatcher;children:ReactNode}) { const draft=useScheduleDraft(initial);return <ScheduleContext.Provider value={draft}>{children}</ScheduleContext.Provider>; }
function useDraft(){const draft=useContext(ScheduleContext);if(!draft)throw new Error('Schedule editor requires its provider');return draft;}
export default function AutomationScheduleEditor({scheduled=false}:{scheduled?:boolean}) {
 const {frequency,setFrequency,selectedDays,setSelectedDays,times,setTimes,nextTimeId,intervalDays,setIntervalDays,startDate,setStartDate,timezone,setTimezone,zones,approval,setApproval,quantity,setQuantity}=useDraft();
 const timeId=useId();
  return <section className="create-card automation-schedule-editor">
    <div className="optional-brief-heading"><CalendarDays size={22}/><h2>Schedule and publishing</h2></div>
    <p className="step-helper">Build a rhythm for your content, then choose how much you want to review.</p>
    <div className="automation-schedule-block">
      <div className="automation-section-label"><Repeat2 size={19}/><h3>When should it run?</h3></div>
<fieldset className="choice-buttons automation-frequency"><legend>Schedule type</legend><input type="hidden" name="frequency" value={frequency}/><div>{[{value:'weekly',label:'Weekly schedule'},{value:'interval',label:'Every X days'}].map(option=><button type="button" key={option.value} className={frequency===option.value?'on':''} aria-pressed={frequency===option.value} onClick={()=>setFrequency(option.value)}>{option.label}</button>)}</div></fieldset>
{frequency==='weekly'?<><fieldset className="automation-days"><legend>Run on these days</legend><div>{days.map((day,index)=><button type="button" key={day} aria-label={fullDays[index]} aria-pressed={selectedDays.includes(day)} className={selectedDays.includes(day)?'on':''} onClick={()=>setSelectedDays(current=>current.includes(day)?current.length>1?current.filter(item=>item!==day):current:[...current,day])}><span>{fullDays[index]}</span><Check size={17} aria-hidden="true"/></button>)}</div></fieldset><div className="automation-day-presets"><button type="button" onClick={()=>setSelectedDays(days.slice(0,5))}>Weekdays</button><button type="button" onClick={()=>setSelectedDays(days.slice(5))}>Weekends</button><small>Keep at least one day selected.</small></div></>:<div className="automation-interval-fields"><label>Run every<div className="automation-interval-input"><input name="intervalDays" type="number" min="1" max="36500" step="1" required value={intervalDays} onChange={event=>setIntervalDays(event.target.value)}/><span>days</span></div></label><label>Starting on<input name="scheduleStartDate" type="date" required value={startDate} onChange={event=>setStartDate(event.target.value)}/></label><p>Count calendar days from this date in your chosen timezone.</p></div>}
{selectedDays.map(day=><input key={day} type="hidden" name="postingDays" value={day}/>)}
<div className="automation-times-section"><div className="automation-section-label"><Clock3 size={19}/><h3>Daily run times</h3></div><p>Generation starts at each time on your scheduled days. Keep at least one time.</p><div className="automation-times-list">{times.map(({id,time},index)=><div className="automation-time-item" key={id}><label htmlFor={timeId+'-'+id}>Time {index+1}</label><input id={timeId+'-'+id} name="postingTimes" aria-label={'Run time '+(index+1)} type="time" required value={time} onChange={event=>setTimes(current=>current.map(row=>row.id===id?{...row,time:event.target.value}:row))}/><button type="button" aria-label={'Remove time '+(index+1)} disabled={times.length===1} onClick={()=>setTimes(current=>current.length>1?current.filter(row=>row.id!==id):current)}><Trash2 size={17}/></button></div>)}</div>{new Set(times.map(row=>row.time).filter(Boolean)).size<times.filter(row=>row.time).length&&<p role="alert" className="provider-error">Each run time must be different.</p>}<button type="button" className="automation-add-time" onClick={()=>{const id=nextTimeId.current++;setTimes(current=>[...current,{id,time:''}]);requestAnimationFrame(()=>document.getElementById(timeId+'-'+id)?.focus());}}><Plus size={17}/>Add time</button></div>
<div className="automation-timezone"><span><Globe size={18}/>Timezone</span><AutomationSelect label="Timezone" name="timezone" value={timezone} onValueChange={setTimezone}>{zones.map(zone=><option key={zone} value={zone}>{zone.replaceAll('_',' ').replaceAll('/',' / ')}</option>)}</AutomationSelect><small>All listed times follow this timezone, including daylight saving.</small></div>
      {scheduled&&<div className="automation-quantity"><div><h3><Layers size={18}/>Content per run</h3><p>Choose how many ideas to create each time.</p></div><div className="automation-stepper"><button type="button" aria-label="Fewer contents per run" disabled={quantity<=1} onClick={()=>setQuantity(value=>Math.max(1,value-1))}><Minus size={18}/></button><output aria-live="polite">{quantity}</output><input type="hidden" name="quantityPerRun" value={quantity}/><button type="button" aria-label="More contents per run" disabled={quantity>=5} onClick={()=>setQuantity(value=>Math.min(5,value+1))}><Plus size={18}/></button></div></div>}
    </div>
    <fieldset className="automation-publishing"><legend><ShieldCheck size={19}/>What happens after each run?</legend><p>Choose a review step or let the automation continue for you.</p><input type="hidden" name="approvalMode" value={approval}/><div className="automation-policy-grid">
      {policies.map(({value,title,detail,Icon})=><button type="button" key={value} aria-pressed={approval===value} className={approval===value?"on":""} onClick={()=>setApproval(value)}><Icon size={23}/><span><b>{title}</b><small>{detail}</small></span><span className="automation-policy-check" aria-hidden="true">{approval===value&&<Check size={14}/>}</span></button>)}
    </div></fieldset>
  </section>;
}
export function AutomationScheduleSummary({scheduled=false,format,model,aspectRatio,platforms=[],assetCount}:{scheduled?:boolean;format:string;model:string;aspectRatio:string;platforms?:string[];assetCount:number}) {
 const {frequency,selectedDays,times,intervalDays,startDate,timezone,approval,quantity}=useDraft();
 const policy=policies.find(item=>item.value===approval)!;
 const activeDays=days.filter(day=>selectedDays.includes(day)).map(day=>fullDays[days.indexOf(day)]);
 const orderedTimes=times.map(row=>row.time).filter(Boolean).sort(),count=scheduled?quantity:1;
 const timeText=(time:string)=>{const [h,m]=time.split(':');return (Number(h)%12||12)+':'+m+' '+(Number(h)<12?'AM':'PM');};
 return <section className="automation-schedule-preview automation-final-summary" aria-label="Your schedule at a glance"><span className="automation-preview-icon"><Sparkles size={24}/></span><div><h2>Your schedule at a glance</h2><strong>{frequency==='weekly'?'Weekly schedule':'Every '+(intervalDays||'…')+' '+(intervalDays==='1'?'day':'days')}</strong><dl>
 <div><dt>{frequency==='weekly'?'Scheduled days':'Start date'}</dt><dd>{frequency==='weekly'?activeDays.join(', '):startDate||'Choose a start date'}</dd></div>
 <div><dt>Run times</dt><dd>{orderedTimes.map(timeText).join(' · ')||'Add a run time'}{times.some(row=>!row.time)&&' · Complete the remaining time'}</dd></div>
 <div><dt>Timezone</dt><dd>{timezone.replaceAll('_',' ')}</dd></div>
 <div><dt>Content</dt><dd>{format} · {model}{format.toLowerCase().includes('text')?'':' · '+aspectRatio}</dd></div>
 <div><dt>{scheduled?'Destinations':'Source'}</dt><dd>{scheduled?platforms.join(', ')||'Choose a platform':'Your monitored source URLs'}</dd></div>
 <div><dt>Reference assets</dt><dd>{assetCount?assetCount+' selected':'No reference assets selected'}</dd></div>
 <div><dt>Run volume</dt><dd>{orderedTimes.length} {orderedTimes.length===1?'run':'runs'} per scheduled day{scheduled?' · '+quantity+' '+(quantity===1?'idea':'ideas')+' per run':''} · {orderedTimes.length*count} {orderedTimes.length*count===1?'idea':'ideas'} per scheduled day{frequency==='weekly'?' · '+orderedTimes.length*count*activeDays.length+' ideas per week':''}</dd></div>
 <div><dt>After each run</dt><dd><b>{policy.title}</b><br/>{policy.detail}</dd></div>
 </dl><p>{policy.outcome}</p><small>Times mark the start of generation. Content becomes available when generation finishes.</small></div></section>;
}
