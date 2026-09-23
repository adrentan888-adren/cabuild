"use client";
import { useId, useState } from "react";
import { Clock3 } from "lucide-react";

export default function AutomationDuration({ model, initial = 8 }: { model:string; initial?:number }) {
  const id=useId();
  const [duration,setDuration]=useState(initial);
  return <fieldset className="creation-duration automation-duration"><legend>Video duration</legend>
    {model!=="seedance-2.0" ? <div className="fixed-duration"><Clock3 size={20}/><b>8 seconds</b><span>{model==="auto"?"Default video length":"Veo Fast"}</span><input type="hidden" name="duration" value="8"/></div>
      : <div className="duration-slider"><label htmlFor={id}><Clock3 size={18}/>Video length <output>{duration} seconds</output></label><input id={id} aria-label="Duration in seconds" type="range" name="duration" min="4" max="15" step="1" value={duration} onChange={event=>setDuration(Number(event.target.value))}/><div><span>4 seconds</span><span>15 seconds</span></div></div>}
  </fieldset>;
}
