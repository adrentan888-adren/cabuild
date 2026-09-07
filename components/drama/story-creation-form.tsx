"use client";
import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, ChevronRight, Search, Sparkles, Star, X } from "lucide-react";
import type { ProductionSnapshot, WorkflowRecord } from "./drama-studio";
import { PageArtwork } from "@/components/page-intro";

type Model = "gemini-3-pro" | "gemini-2.5-flash";
export default function StoryCreationForm({ snapshot, sources, selectedSourceId, model, models, estimatedCost, busy, onModel, onUpdate, onSelect, onGenerate }: {
 snapshot: ProductionSnapshot; sources: WorkflowRecord[]; selectedSourceId: string;
 model: Model; models: Array<{value: Model; label:string; credits:number}>; estimatedCost:number; busy:boolean;
 onModel:(model:Model)=>void; onUpdate:(patch:Partial<ProductionSnapshot>)=>void; onSelect:(id:string)=>void; onGenerate:()=>void;
}) {
 const [pickerOpen,setPickerOpen]=useState(false),[query,setQuery]=useState(""),[favoritesOnly,setFavoritesOnly]=useState(false),[candidateId,setCandidateId]=useState("");
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const selected=sources.find(record=>record.id===selectedSourceId);
 const readySources=sources.filter(record=>record.status!=="generating"&&record.status!=="failed"&&record.snapshot.generatedBrief.trim());
 const visible=readySources.filter(record=>(!favoritesOnly||record.favorite)&&`${record.snapshot.title} ${record.snapshot.generatedBrief} ${record.snapshot.style} ${record.snapshot.language}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const candidate=readySources.find(record=>record.id===candidateId);
 useEffect(()=>{if(pickerOpen)dialog.current?.showModal();else dialog.current?.close();},[pickerOpen]);
 const close=()=>setPickerOpen(false);
 const choose=()=>{if(!candidate)return;onSelect(candidate.id);close();};
 return <div className="creative-brief-form story-creation-form"><div className="content-main">
  <section className="card brief-story-section">
   <div className="card-heading"><div><h2>Shape your Story Studio</h2><p>Review your brief before creating the season, episodes, characters and visual-asset plan.</p></div><BookOpen size={23}/></div>
   <div className="field"><label htmlFor="story-production-title">Production title</label><input id="story-production-title" value={snapshot.title} onChange={event=>onUpdate({title:event.target.value})} placeholder="Untitled drama"/></div>
   <div className="story-source-summary"><div><span className="context-kicker">Starting point</span><b>{selected ? selected.snapshot.title || selected.name : "Your own brief"}</b><p>{selected ? "A copy is loaded below. Your edits apply to this Story Studio." : "Write your brief below or choose one from your library."}</p></div><button ref={trigger} className="secondary-button" onClick={()=>{setCandidateId(selectedSourceId);setQuery("");setFavoritesOnly(false);setPickerOpen(true);}}><Search size={16}/>{selected ? "Change Brief" : "Choose Brief"}</button></div>
   <div className="field"><label htmlFor="story-finished-brief">Finished brief</label><textarea id="story-finished-brief" value={snapshot.generatedBrief} onChange={event=>onUpdate({generatedBrief:event.target.value})} placeholder="Write or paste the creative brief for your story."/><p className="story-input-note">Edit this copy freely. The saved Creative Brief stays unchanged.</p></div>
   <div className="story-inherited-summary" aria-label="Inherited production settings"><span>{snapshot.episodes} episodes</span><span>{snapshot.episodeLength} min each</span><span>{snapshot.style}</span><span>{snapshot.language}</span><span>{snapshot.rating}</span></div>
  </section>
  <section className="card model-choice-panel"><div className="card-heading"><div><h2>Choose the writing model</h2><p>Choose the balance of detail, speed and cost for your Story Studio.</p></div></div><fieldset className="brief-choices writing-model-choices"><legend>Story generation model</legend><div className="brief-choice-options">{models.map(option=><label key={option.value} className={model===option.value?"selected":""}><input type="radio" name="story-generation-model" checked={model===option.value} onChange={()=>onModel(option.value)}/><span><b>{option.label.split(" · ")[0]}</b><small>{option.label.split(" · ")[1]} · ≈{option.credits} credits</small></span></label>)}</div></fieldset></section>
  <div className="brief-generate-footer"><span>Estimated cost: ≈ {estimatedCost} credits</span><button className="primary-button" disabled={busy||!snapshot.generatedBrief.trim()} onClick={onGenerate}><Sparkles size={20}/> Generate</button></div>
 </div>
 <dialog ref={dialog} className="brief-info-dialog saved-work-dialog" aria-labelledby="saved-work-title" onCancel={event=>{event.preventDefault();close();}} onClose={()=>{setPickerOpen(false);trigger.current?.focus();}} onClick={event=>{if(event.target!==event.currentTarget)return;const r=event.currentTarget.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}}>
  <header><div><span className="page-intro-kicker">Creative Brief library</span><h2 id="saved-work-title">Choose your starting point</h2></div><PageArtwork kind="library"/></header>
  <div className="brief-info-body"><div className="saved-work-toolbar"><label className="saved-work-search"><Search size={17}/><input aria-label="Search saved briefs" placeholder="Search title, story or settings" value={query} onChange={event=>{setQuery(event.target.value);setCandidateId("");}} autoFocus/></label><button className={`brief-favorites-filter ${favoritesOnly?"selected":""}`} aria-pressed={favoritesOnly} onClick={()=>{setFavoritesOnly(!favoritesOnly);setCandidateId("");}}><Star size={16}/>Favorites</button></div>
  <fieldset className="saved-work-options"><legend>{visible.length} ready {visible.length===1?"brief":"briefs"}</legend>{visible.map(record=><label className={`saved-work-card ${candidateId===record.id?"selected":""}`} key={record.id}><input type="radio" name="saved-brief-choice" value={record.id} checked={candidateId===record.id} onChange={()=>setCandidateId(record.id)}/><span className="saved-work-radio" aria-hidden="true">{candidateId===record.id&&<Check size={13}/>}</span><span className="saved-work-copy"><b>{record.favorite&&<Star size={15} fill="currentColor"/>}{record.snapshot.title||record.name}</b></span></label>)}</fieldset>
  {!visible.length&&<div className="saved-work-empty"><BookOpen size={26}/><h3>{readySources.length?"No matching briefs":"No ready briefs yet"}</h3><p>{readySources.length?"Try another search or turn off Favorites.":"You can close this picker and write your own brief."}</p></div>}
  </div><footer><button className="secondary-button" onClick={close}><X size={15}/>Cancel</button><button className="primary-button" disabled={!candidate} onClick={choose}>Use this brief <ChevronRight size={16}/></button></footer>
 </dialog>
 </div>;
}
