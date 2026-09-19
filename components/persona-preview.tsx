import type { PersonaProfile } from "@/lib/types";

function Detail({ label, value }: { label: string; value?: string | string[] }) {
  return <div className="persona-preview-detail"><dt>{label}</dt><dd>{Array.isArray(value) ? value.length ? <ul>{value.map((text, index) => <li key={index}>{text}</li>)}</ul> : "Not added yet" : value?.trim() || "Not added yet"}</dd></div>;
}

function publicUrl(value: string) {
  try { const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); return ["https:", "http:"].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}

export default function PersonaPreview({ persona }: { persona: PersonaProfile }) {
  return <div className="persona-preview" aria-label="Persona preview">
    <section className="persona-advanced"><h2 className="persona-section-title">Core profile</h2><dl className="persona-preview-grid"><Detail label="Display name" value={persona.displayName} /><Detail label="Role" value={persona.role} /><Detail label="Company" value={persona.company} /><Detail label="Company one-liner" value={persona.companyOneLiner} /></dl></section>
    <section className="persona-advanced"><h2 className="persona-section-title">Audience and voice</h2><dl className="persona-preview-grid"><Detail label="Primary audience" value={persona.primaryAudience} /><Detail label="Audience insight" value={persona.audienceInsight} /><Detail label="Voice style" value={persona.voiceStyle} /><Detail label="Content language" value={persona.contentLanguage} /><Detail label="Writing samples" value={persona.writingSamples} /></dl></section>
    <section className="persona-advanced"><h2 className="persona-section-title">Prompt guardrails</h2><dl className="persona-preview-grid"><Detail label="Natural phrases" value={persona.naturalPhrases} /><Detail label="Banned vocabulary" value={persona.bannedVocabulary} /><Detail label="Approved topics" value={persona.approvedTopics} /><Detail label="Off-limits topics" value={persona.offLimitsTopics} /><Detail label="Strong opinions" value={persona.strongOpinions} /></dl></section>
    <section className="persona-advanced"><h2 className="persona-section-title">Public profiles</h2><dl className="persona-preview-grid">{Object.entries(persona.sourceUrls).map(([label, value]) => <div className="persona-preview-detail" key={label}><dt>{label === "x" ? "X / Twitter" : label[0].toUpperCase() + label.slice(1)}</dt><dd>{value && publicUrl(value) ? <a href={publicUrl(value)} target="_blank" rel="noreferrer">{value}</a> : value || "Not added yet"}</dd></div>)}</dl></section>
    <section className="persona-advanced"><h2 className="persona-section-title">Reusable media references</h2><div className="persona-preview-media">{(persona.mediaAssets || []).map(asset => <figure key={asset.id}>{asset.role === "audio" || asset.contentType?.startsWith("audio/") ? <audio controls preload="none" src={asset.url} aria-label={asset.label || asset.fileName} /> : <a href={asset.url} target="_blank" rel="noreferrer"><img src={asset.url} alt={asset.label || asset.fileName} /></a>}<figcaption><b>{asset.label || asset.fileName}</b><span>{asset.role}</span><small>{asset.fileName}</small></figcaption></figure>)}</div>{!persona.mediaAssets?.length && <p className="muted">No saved media references yet.</p>}</section>
  </div>;
}
