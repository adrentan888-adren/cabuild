"use client";
import { Cpu, FileText, Film, ImageIcon, Radar, SlidersHorizontal } from "lucide-react";
import AutomationDuration from "./automation-duration";
import ChoiceButtons, { AspectRatioIcon } from "./choice-buttons";

type Option={value:string;label:string};
export default function AutomationFormatControls({ contentType, formats, onTypeChange, model, models, onModelChange, aspectRatio, ratios, onRatioChange, duration }: {
  contentType:string; formats:Option[]; onTypeChange:(value:string)=>void; model:string; models:readonly Option[]; onModelChange:(value:string)=>void;
  aspectRatio:string; ratios:Option[]; onRatioChange:(value:string)=>void; duration?:number;
}) {
  const video=contentType.includes("video")||contentType==="auto";
  return <>
    <fieldset className="automation-format"><legend>Content type</legend><input type="hidden" name="contentType" value={contentType}/><div className="create-type-grid">
      {formats.map(format=>{const Icon=format.value==="auto"?Radar:format.value.includes("video")?Film:format.value==="text"?FileText:ImageIcon;return <button type="button" key={format.value} aria-pressed={format.value===contentType} className={format.value===contentType?"on":""} onClick={()=>onTypeChange(format.value)}><Icon size={23}/><b>{format.label}</b><span>{format.value==="auto"?"Match the source format":format.value==="text"?"Captions and written posts":format.value==="image"?"Visual stories and graphics":format.value==="long-video"?"Landscape video format":"Reels, Shorts and social clips"}</span></button>;})}
    </div></fieldset>
    <div className="creation-option-group"><div className="clbl"><Cpu size={19}/>Model</div><input type="hidden" name="model" value={model}/><div className="model-options create-model-options" role="group" aria-label="Model">
      {models.map(option=><button type="button" key={option.value} aria-pressed={model===option.value} className={model===option.value?"on":""} onClick={()=>onModelChange(option.value)}><span className="mcard-dot"/><b>{option.label}</b></button>)}
    </div></div>
    {ratios.length>0&&<div className="creation-option-group"><div className="clbl"><SlidersHorizontal size={19}/>Generation settings</div><div className="generation-choice-grid" data-video={video}>
      {video&&<AutomationDuration model={contentType==="auto"?"auto":model} initial={duration}/>}
      <div className="creation-aspect-ratio"><ChoiceButtons label="Aspect ratio" name="aspectRatio" value={aspectRatio} options={ratios.map(option=>({value:option.value,label:option.value,icon:<AspectRatioIcon value={option.value}/>}))} onChange={onRatioChange}/></div>
    </div></div>}
    {!ratios.length&&<input type="hidden" name="aspectRatio" value="1:1"/>}
  </>;
}
