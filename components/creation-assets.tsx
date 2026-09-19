"use client";

import { useState } from "react";
import { ImageIcon, Mic, Sparkles, Upload, UserRound } from "lucide-react";
import type { PersonaMediaAsset } from "@/lib/types";
import ContentDialog from "./content-dialog";

type Role = PersonaMediaAsset["role"];
type LocalAsset = { role: Role; fileName: string; previewUrl: string; file: File };
const sections = [
  { role: "logo", title: "Logo", icon: Sparkles },
  { role: "product photo", title: "Product photos", icon: ImageIcon },
  { role: "avatar/persona", title: "Person / avatar", icon: UserRound },
  { role: "audio", title: "Audio", icon: Mic },
] as const;

export default function CreationAssets({ personaAssets, selectedIds, uploads, usePersona, video, onSelect, onUpload, onClear }: {
  personaAssets: PersonaMediaAsset[]; selectedIds: string[]; uploads: LocalAsset[]; usePersona: boolean; video: boolean;
  onSelect: (role: Role, ids: string[]) => void; onUpload: (role: Role, file: File) => void; onClear: (role: Role) => void;
}) {
  const [role, setRole] = useState<Role | null>(null);
  const [source, setSource] = useState<"persona" | "upload">("persona");
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const section = sections.find(item => item.role === role);
  const candidates = personaAssets.filter(item => item.role === role);
  const open = (next: Role) => {
    setRole(next); setDraftIds(selectedIds.filter(id => personaAssets.some(item => item.id === id && item.role === next)));
    setSource(usePersona && personaAssets.some(item => item.role === next) ? "persona" : "upload");
  };
  return <div className="creation-assets">
    <div className="creation-asset-grid">{sections.map(({ role: assetRole, title, icon: Icon }) => {
      const upload = uploads.find(item => item.role === assetRole);
      const saved = usePersona ? personaAssets.filter(item => item.role === assetRole && selectedIds.includes(item.id)) : [];
      const preview = upload?.previewUrl || saved[0]?.url;
      const populated = !!upload || saved.length > 0;
      const unavailable = assetRole === "audio" && !video;
      return <section key={assetRole} className="creation-asset-section" aria-label={title}>
        <h3><Icon size={20} />{title}</h3>
        {populated ? <div className="creation-asset-selected">
          {assetRole !== "audio" && preview && <img src={preview} alt={`${title} reference`} />}
          <div><b>{upload?.fileName || saved.map(item => item.label || item.fileName).join(", ")}</b><small>{upload ? "From your device" : "From Persona"}</small></div>
        </div> : <p className="asset-empty">Not uploaded</p>}
        {unavailable && <small>Audio references are used for video only.</small>}
        <div className="row-actions"><button type="button" disabled={unavailable} onClick={() => open(assetRole)} aria-label={`${populated ? "Change" : "Upload"} ${title}`}><Upload size={15} />{populated ? "Change" : "Upload"}</button>
          {populated && <button type="button" className="linkish" onClick={() => onClear(assetRole)} aria-label={`Remove ${title}`}>Remove</button>}</div>
      </section>;
    })}</div>
    {section && role && <ContentDialog title={`Choose ${section.title}`} onClose={() => setRole(null)}>
      <div className="asset-source-buttons" role="group" aria-label="Asset source">
        <button type="button" aria-pressed={source === "persona"} onClick={() => setSource("persona")}>From Persona</button>
        <button type="button" aria-pressed={source === "upload"} onClick={() => setSource("upload")}>Upload file</button>
      </div>
      {source === "persona" ? <>
        {!usePersona ? <p>Select your Persona at the top of Create Content to use its saved assets.</p> : candidates.length ? <div className="asset-persona-options">{candidates.map(asset => <label key={asset.id}>
          <input type={role === "product photo" ? "checkbox" : "radio"} name="asset-persona-choice" checked={draftIds.includes(asset.id)} onChange={event => setDraftIds(current => role !== "product photo" ? [asset.id] : event.target.checked ? [...current, asset.id] : current.filter(id => id !== asset.id))} />
          {role !== "audio" && <img src={asset.url} alt="" />}<span>{asset.label || asset.fileName}</span>
        </label>)}</div> : <p>No {section.title.toLowerCase()} uploaded to Persona yet.</p>}
        <div className="dialog-actions"><button type="button" onClick={() => setRole(null)}>Cancel</button><button type="button" className="primary" disabled={!usePersona || !draftIds.length} onClick={() => { onSelect(role, draftIds); setRole(null); }}>Use selected assets</button></div>
      </> : <div className="asset-file-upload"><Upload size={26} /><label>Upload {section.title}<input type="file" accept={role === "audio" ? "audio/*" : "image/*"} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) { onUpload(role, file); setRole(null); } }} /></label><p>This file is used for this content only.</p></div>}
    </ContentDialog>}
  </div>;
}
