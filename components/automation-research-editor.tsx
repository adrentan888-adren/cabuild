"use client";
import { useState } from "react";
import { BookOpen, FileText, Link2, Radar, Search, ShieldCheck } from "lucide-react";
import type { AutomationRule } from "@/lib/types";

export default function AutomationResearchEditor({ initial }: { initial?: AutomationRule }) {
  const [mode,setMode]=useState(initial?.researchMode||"keywords");
  return <section className="create-card automation-research-editor">
    <div className="optional-brief-heading"><Radar size={22}/><h2>Research and guidance</h2></div><p className="step-helper">Give each run a direction and a few boundaries to follow.</p>
    <fieldset className="automation-research-modes"><legend>Where should ideas come from?</legend><input type="hidden" name="researchMode" value={mode}/><div>
      {([{value:"keywords",title:"My topics",description:"Guide ideas with keywords and subjects.",Icon:Search},{value:"latest-research",title:"Saved research",description:"Use the latest results from your Research page.",Icon:BookOpen},{value:"none",title:"Instructions only",description:"Start from your main instruction and brand context.",Icon:FileText}] as const).map(({value,title,description,Icon})=><button type="button" key={value} className={mode===value?"on":""} aria-pressed={mode===value} onClick={()=>setMode(value)}><Icon size={23}/><span><b>{title}</b><small>{description}</small></span></button>)}
    </div></fieldset>
    <div className="automation-research-guidance" role="status">{mode==="keywords"?"Add the topics you want to cover below. Each run uses them to guide its content ideas.":mode==="latest-research"?"Each run can draw on your latest saved Research results. Add topics or links below for extra context.":"Your main instruction leads the brief. Any topics and reference links below remain available as extra context."}</div>
    <label className="automation-guidance-field"><span><Search size={18}/>Topics and keywords <small>Optional</small></span><p>One topic per line. Be specific about what your audience cares about.</p><textarea name="keywords" placeholder={"First-time buyer questions\nPractical budgeting tips\nCustomer success stories"} defaultValue={initial?.keywords?.join("\n")||""}/></label>
    <label className="automation-guidance-field"><span><Link2 size={18}/>Reference links <small>Optional</small></span><p>Add one source URL per line to give your content more context.</p><textarea name="sourceUrls" placeholder="https://example.com/reference" defaultValue={initial?.sourceUrls?.join("\n")||""}/></label>
    <label className="automation-guidance-field"><span><ShieldCheck size={18}/>Things to avoid <small>Optional</small></span><p>Set any claims, subjects or wording the AI should stay away from.</p><textarea name="restrictions" placeholder="For example: avoid guaranteed results, competitor names or unsupported claims." defaultValue={initial?.restrictions||""}/></label>
  </section>;
}
