import type { Asset, PublishItem } from "@/lib/types";
import ContentDialog from "./content-dialog";

export default function ContentInfo({ item, asset, onClose }: { item: PublishItem; asset?: Asset; onClose: () => void }) {
  const settings = { ...asset?.generationSettings, ...item.generationSettings };
  const references = item.assetReferences || asset?.assetReferences || [];
  const details = [
    ["Content type", item.generationType || asset?.type], ["Model", item.generationModel || asset?.generationModel],
    ["Platform", item.platform], ["Created", item.createdAt || asset?.createdAt],
    ["Persona", settings.usePersona === false ? "No persona" : settings.personaName || (settings.usePersona === true ? "Saved persona" : "Not recorded for this older item")],
    ["Aspect ratio", settings.aspectRatio], ["Duration", item.duration || settings.duration],
    ["Variants", settings.variants], ["Tone", settings.tone], ["Length", settings.length],
  ];
  return <ContentDialog title="Content information" description={item.title} onClose={onClose}>
    <div className="content-information"><dl className="persona-preview-grid">{details.map(([label, value]) => <div key={String(label)} className="persona-preview-detail"><dt>{String(label)}</dt><dd>{value === undefined || value === "" ? "Not recorded" : String(value)}</dd></div>)}</dl>
      <section><h3>Prompt sent to AI</h3><pre>{asset?.prompt || item.prompt || "No prompt was stored for this older item."}</pre></section>
      {typeof settings.inputPrompt === "string" && <section><h3>Your submitted prompt</h3><pre>{settings.inputPrompt}</pre></section>}
      <section><h3>Caption</h3><p>{item.caption || "No caption"}</p><h3>Hashtags</h3><p>{item.hashtags?.join(" ") || "No hashtags"}</p></section>
      <section><h3>Reference assets</h3>{references.length ? <ul>{references.map((reference, index) => <li key={index}><b>{reference.role}</b> · {reference.fileName}{reference.url && <> · <a href={reference.url} target="_blank" rel="noreferrer">View reference</a></>}</li>)}</ul> : <p>No reference assets recorded.</p>}</section>
      {(item.sourceUrl || asset?.sourceUrl) && <section><h3>Research source</h3><p>{item.sourceTitle || asset?.sourceTitle}</p><a href={item.sourceUrl || asset?.sourceUrl} target="_blank" rel="noreferrer">Open original source</a></section>}
    </div>
  </ContentDialog>;
}
