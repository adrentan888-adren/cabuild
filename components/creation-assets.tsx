"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon, Mic, Plus, Sparkles, Upload, UserRound, X } from "lucide-react";
import type { GenerationAssetReference, PersonaMediaAsset } from "@/lib/types";
import ContentDialog from "./content-dialog";

type Role = PersonaMediaAsset["role"];
type LocalAsset = { role: Role; fileName: string; previewUrl: string; file: File };
const sections = [
  { role: "logo", title: "Logo", icon: Sparkles },
  { role: "product photo", title: "Product photos", icon: ImageIcon },
  { role: "avatar/persona", title: "Person / avatar", icon: UserRound },
  { role: "audio", title: "Audio", icon: Mic },
] as const;

export default function CreationAssets({ personaAssets, selectedIds, uploads, usePersona, video, onSelect, onUpload, onClear, retainedAssets = [], inlinePicker = false }: {
  personaAssets: PersonaMediaAsset[]; selectedIds: string[]; uploads: LocalAsset[]; usePersona: boolean; video: boolean;
  onSelect: (role: Role, ids: string[]) => void; onUpload: (role: Role, file: File) => void; onClear: (role: Role) => void;
  retainedAssets?: GenerationAssetReference[]; inlinePicker?: boolean;
}) {
  const [role, setRole] = useState<Role | null>(null);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const section = sections.find(item => item.role === role);
  const candidates = personaAssets.filter(item => item.role === role);
  const inlineHeading = useRef<HTMLHeadingElement>(null);
  useEffect(()=>{if(inlinePicker&&role){inlineHeading.current?.focus();inlineHeading.current?.scrollIntoView({block:"center"});}},[inlinePicker,role]);
  const close = () => { if(inlinePicker&&role)document.getElementById(`creation-asset-${role.replace(/[^a-z]/g,"-")}`)?.focus();setRole(null); };
  const open = (next: Role) => {
    setRole(next); setDraftIds(selectedIds.filter(id => personaAssets.some(item => item.id === id && item.role === next)));
  };
  return <div className="creation-assets">
    <div className="creation-asset-grid">{sections.map(({ role: assetRole, title, icon: Icon }) => {
      const upload = uploads.find(item => item.role === assetRole);
      const saved = usePersona ? personaAssets.filter(item => item.role === assetRole && selectedIds.includes(item.id)) : [];
      const retained = retainedAssets.filter(item=>item.role===assetRole);
      const previews = upload ? [upload.previewUrl] : [...retained.map(asset=>asset.url).filter((url):url is string=>Boolean(url)), ...saved.map(asset => asset.url)];
      const populated = !!upload || saved.length > 0 || retained.length > 0;
      const unavailable = assetRole === "audio" && !video;
      return <section key={assetRole} className="creation-asset-section" aria-label={title}>
        <h3><Icon size={20} />{title}</h3>
        {populated ? <div className="creation-asset-selected">
          {assetRole === "audio" ? <div className="creation-audio-preview"><Mic size={36} /><audio controls preload="none" src={previews[0]} aria-label="Selected audio reference" /></div> : <div className={`creation-asset-images${previews.length > 1 ? " multiple" : ""}`}>{previews.map((preview, index) => <img key={index} src={preview} alt={`${title} reference ${index + 1}`} />)}</div>}
          <small>{upload ? "From your device" : retained.length ? "Saved with automation" : "From Persona"}{previews.length > 1 ? ` · ${previews.length} selected` : ""}</small>
        </div> : <div className="asset-empty"><Icon size={32} /><span>Not uploaded</span></div>}
        {unavailable && <small>Audio references are used for video only.</small>}
        <div className="row-actions"><button id={`creation-asset-${assetRole.replace(/[^a-z]/g, "-")}`} type="button" disabled={!populated && unavailable} onClick={() => populated ? onClear(assetRole) : open(assetRole)} aria-label={`${populated ? "Remove" : "Add"} ${title}`}>{populated ? <X size={15} /> : <Plus size={15} />}{populated ? "Remove" : "Add"}</button></div>
      </section>;
    })}</div>
    {section && role && <AssetPickerContainer inline={inlinePicker} title={`Choose ${section.title}`} onClose={close} headingRef={inlineHeading}>
      <div className="asset-picker-page">
        <section className="asset-persona-section"><h3><UserRound size={19} />From Persona</h3>
          {!usePersona ? <p>Select your Persona at the top of Create Content to use its saved assets.</p> : candidates.length ? <div className="asset-persona-options">{candidates.map((asset, index) => <label key={asset.id} className={draftIds.includes(asset.id) ? "selected" : ""}>
            <input aria-label={`${section.title} reference ${index + 1}`} type={role === "product photo" ? "checkbox" : "radio"} name="asset-persona-choice" checked={draftIds.includes(asset.id)} onChange={event => setDraftIds(current => role !== "product photo" ? [asset.id] : event.target.checked ? [...current, asset.id] : current.filter(id => id !== asset.id))} />
            {role === "audio" ? <Mic size={36} /> : <img src={asset.url} alt={`${section.title} reference ${index + 1}`} />}
            <span className="asset-reference-label">Reference {index + 1}</span>
          </label>)}</div> : <p>No {section.title.toLowerCase()} uploaded to Persona yet.</p>}
          {usePersona && candidates.length > 0 && <button type="button" className="primary" disabled={!draftIds.length} onClick={() => { onSelect(role, draftIds); close(); }}><Plus size={16} />Add selected assets</button>}
        </section>
        <section className="asset-file-upload"><h3><Upload size={19} />From your device</h3><p>Add an {role === "audio" ? "audio file" : "image"} for this content.</p><label className="asset-file-input"><Plus size={19} /><span>Add {section.title}</span><input aria-label={`Add ${section.title} from your device`} type="file" accept={role === "audio" ? "audio/*" : "image/*"} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) { onUpload(role, file); close(); } }} /></label></section>
      </div>
      <div className="dialog-actions"><button type="button" onClick={close}>Cancel</button></div>
    </AssetPickerContainer>}
  </div>;
}

function AssetPickerContainer({inline,title,onClose,headingRef,children}:{inline:boolean;title:string;onClose:()=>void;headingRef:React.RefObject<HTMLHeadingElement>;children:React.ReactNode}) {
  return inline?<section className="automation-asset-picker" aria-label={title}><h3 ref={headingRef} tabIndex={-1}>{title}</h3>{children}</section>:<ContentDialog title={title} onClose={onClose}>{children}</ContentDialog>;
}
