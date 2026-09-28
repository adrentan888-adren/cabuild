"use client";
import { useState, type ReactNode } from 'react';
import { BarChart3, ExternalLink, Film, ImageIcon, Info } from 'lucide-react';
import ContentDialog from './content-dialog';
import CreatorFilterSelect from './creator-filter-select';
import { safeUrl } from '@/lib/insights';

export function InsightMetric({label,value,detail,icon}:{label:string;value:string;detail:string;icon:ReactNode}) { return <article className="insight-metric"><span className="insight-metric-icon">{icon}</span><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
export function InsightHeading({icon,title,description,children}:{icon:ReactNode;title:string;description?:string;children?:ReactNode}) { return <header className="insight-section-heading"><div><h2>{icon}{title}</h2>{description&&<p>{description}</p>}</div>{children}</header>; }
export function InsightSelect({label,value,options,onChange}:{label:string;value:string;options:{value:string;label:string}[];onChange:(value:string)=>void}) {return <CreatorFilterSelect label="" accessibleLabel={label} value={value} defaultValue={options[0]?.value||''} options={options} onChange={onChange}/>;}
export function InsightEmpty({title,children}:{title:string;children:ReactNode}) {return <div className="insight-empty"><BarChart3 size={30}/><h3>{title}</h3><p>{children}</p></div>;}
export function InsightThumb({url,title,video=false}:{url?:string;title:string;video?:boolean}) {
 const [failed,setFailed]=useState(false); const src=safeUrl(url);
 return <span className="insight-thumb">{src&&!failed?<img src={src} alt="" loading="lazy" onError={()=>setFailed(true)}/>:<span>{video?<Film size={26}/>:<ImageIcon size={26}/>}<small>{title}</small></span>}</span>;
}
export function InsightMedia({title,url,thumbnail,type,sourceUrl,children,onClose}:{title:string;url?:string;thumbnail?:string;type?:string;sourceUrl?:string;children?:ReactNode;onClose:()=>void}) {
 const [failed,setFailed]=useState(false);const media=safeUrl(url),thumb=safeUrl(thumbnail),source=safeUrl(sourceUrl);
 const video=type==='video'||type==='ugc'||/\.(mp4|webm|mov)(\?|$)/i.test(media||'');
 const image=type==='image'||type==='carousel'||/\.(png|jpe?g|webp|gif)(\?|$)/i.test(media||'');
 return <ContentDialog title="Post preview" description={title} onClose={onClose}><div className="insight-preview">
 {!failed&&media&&video?<video src={media} controls playsInline onError={()=>setFailed(true)}/>:!failed&&(image&&media||thumb)?<img src={image&&media||thumb} alt={title} onError={()=>setFailed(true)}/>:<div className="insight-empty"><Film size={30}/><b>{failed?'Media could not be loaded':'No media preview available'}</b><p>{source?'You can still open the original post below.':'Saved details are available below.'}</p></div>}
 {children}{source&&<a href={source} target="_blank" rel="noreferrer" className="asset-link"><ExternalLink size={16}/>Open original post</a>}</div></ContentDialog>;
}
export function InsightNote({children}:{children:ReactNode}) {return <p className="insight-note"><Info size={17}/><span>{children}</span></p>;}
export function InsightBars({rows}:{rows:{label:string;value:number;detail?:string}[]}) {const max=Math.max(1,...rows.map(row=>row.value));return <ul className="insight-bars">{rows.map(row=><li key={row.label}><div><span>{row.label}</span><b>{row.value.toLocaleString()}</b></div><span className="insight-bar-track" aria-hidden="true"><span style={{width:row.value/max*100+'%'}}/></span>{row.detail&&<small>{row.detail}</small>}</li>)}</ul>;}
