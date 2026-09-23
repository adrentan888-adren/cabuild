"use client";
import { Children, isValidElement, useState, type ReactElement, type ReactNode } from "react";
import CreatorFilterSelect from "./creator-filter-select";
export default function AutomationSelect({ label, name, value, defaultValue, onValueChange, children }: {label:string;name:string;value?:string;defaultValue?:string;onValueChange?:(value:string)=>void;children:ReactNode}) {
 const options=Children.toArray(children).filter(isValidElement).map(node=>{const item=node as ReactElement<{value?:string;children:ReactNode}>;return{value:String(item.props.value ?? item.props.children),label:String(item.props.children)}});
 const [local,setLocal]=useState(defaultValue||options[0]?.value||"");const current=value??local;
 return <div className="automation-select"><input type="hidden" name={name} value={current}/><CreatorFilterSelect label="" accessibleLabel={label} value={current} defaultValue={options[0]?.value||""} options={options} onChange={value=>{setLocal(value);onValueChange?.(value)}}/></div>;
}
