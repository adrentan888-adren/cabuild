import { Download, Eye, FileText, Film, ImageIcon, Info } from "lucide-react";
import type { Asset, PublishItem } from "@/lib/types";

export default function ContentOutputCard({ item, asset, onPreview, onInfo, onSource }: {
  item: PublishItem; asset?: Asset; onPreview: () => void; onInfo: () => void; onSource?: () => void;
}) {
  const video = item.generationType === "video" || asset?.type === "video" || asset?.type === "ugc";
  const image = !video && (item.generationType === "image" || asset?.type === "image" || asset?.type === "carousel");
  const url = item.assetUrl || asset?.assetUrl;
  const type = video ? "Video" : image ? "Image" : "Text post";
  const TypeIcon = video ? Film : image ? ImageIcon : FileText;
  const createdAt = item.createdAt || item.scheduledAt;
  return <article className="publish-card content-output-card">
    {video || image ? <button type="button" className={`content-output-media ${video ? "video-thumb" : "image-thumb"}${url ? "" : " pending"}`} disabled={!url} onClick={onPreview} aria-label={`Preview ${type.toLowerCase()}: ${item.title}`}>
      {url ? video ? <video src={url} muted preload="metadata" playsInline /> : <img src={url} alt={item.title} /> : <TypeIcon size={30} />}
      <span>{url ? `Preview ${type.toLowerCase()}` : item.status === "failed" ? "No media generated" : "Generating…"}</span>
    </button> : <div className="content-output-media text-output"><FileText size={32} /><span>Text post</span></div>}
    <div className="content-output-heading"><h3>{item.title}</h3><span className={`status ${item.status}`}>{item.status === "done" ? "Done" : item.status}</span></div>
    <div className="content-output-description"><p>{item.caption || "No description added."}</p>{item.hashtags?.length ? <small>{item.hashtags.join(" ")}</small> : null}
      {item.status === "generating" && <small role="status">Generation continues in the background.</small>}
      {item.error && <p className="provider-error" role="alert">{item.error}</p>}
      {onSource && <button type="button" className="content-source-link" onClick={onSource}><Eye size={15} />View source media</button>}
    </div>
    <footer className="content-output-footer">
      <span className="content-type-label"><TypeIcon size={17} aria-hidden="true" />{type}</span>
      <time dateTime={createdAt}>{new Date(createdAt).toLocaleString(undefined, { year:"numeric", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" })}</time>
      <div className="content-output-actions">
      {url && (video || image) && <a className="icon-btn" href={`/api/assets/${item.assetId}/download`} aria-label={`Download ${type.toLowerCase()}`} title={`Download ${type.toLowerCase()}`}><Download size={19} /></a>}
      <button type="button" className="icon-btn" onClick={onInfo} aria-label="Info" title="Content information"><Info size={19} /></button>
      </div>
    </footer>
  </article>;
}
