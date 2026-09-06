"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Info, LoaderCircle, Trash2, X } from "lucide-react";
import type { WorkflowRecord } from "./drama-studio";

export default function BriefLibraryCard({ record, stories, onUse, onDelete }: {
  record: WorkflowRecord;
  stories: WorkflowRecord[];
  onUse: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const infoButton = useRef<HTMLButtonElement>(null);
  const snapshot = record.snapshot;
  const state = record.status ?? (snapshot.generatedBrief.trim() ? "ready" : "failed");
  const ready = state === "ready";
  const label = state === "generating" ? "Generating" : ready ? "Ready" : "Failed";
  const title = snapshot.title || record.name.replace(/ · Brief$/, "");
  const date = new Date(record.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const settings = [
    ["Working title", title], ["Rough story", snapshot.roughStory], ["Extra AI direction", snapshot.seedPrompt || "None"],
    ["Episodes", String(snapshot.episodes)], ["Length per episode", `${snapshot.episodeLength} minutes`],
    ["Aspect ratio", snapshot.aspectRatio], ["Visual style", snapshot.style], ["Pacing", snapshot.pacing],
    ["Language", snapshot.language], ["Audience", snapshot.audience], ["Content rating", snapshot.rating],
    ["Tone", snapshot.tone.join(", ")], ["Continuity strength", snapshot.continuity || "Not specified"],
    ["Writing model", record.model || "Not recorded"],
  ];
  useEffect(() => {
    if (showInfo) dialog.current?.showModal();
    else dialog.current?.close();
  }, [showInfo]);
  const close = () => { setShowInfo(false); infoButton.current?.focus(); };
  const next = () => { close(); onUse(); };
  return (
    <article className={`stage-record-card brief-library-card ${expanded ? "expanded" : "collapsed"}`}>
      <header className="brief-library-header">
        <div className="brief-library-title"><h3>{title}</h3><span className={`status-pill brief-status-${state}`} role="status">{state === "generating" && <LoaderCircle size={13} className="brief-status-spinner" />}{label}</span></div>
        <div className="brief-library-actions">
          <button className="secondary-button" onClick={onUse} disabled={!ready} title="Use this brief to set up a Story Studio. Generation starts only when you choose Generate there.">Create Story Studio <ArrowRight size={15} /></button>
          <button className="icon-button brief-collapse" onClick={() => setExpanded(!expanded)} aria-label={`${expanded ? "Collapse" : "Expand"} ${title}`} aria-expanded={expanded} aria-controls={`brief-content-${record.id}`}><ChevronDown size={18} /></button>
        </div>
      </header>
      {expanded && <div id={`brief-content-${record.id}`} className="brief-library-content">
        {state === "generating" ? <p>Generating your creative brief. You can leave this page and return to check its progress.</p> : state === "failed" ? <p className="brief-error">{record.error || "This brief has no finished result."}</p> : <div className="brief-readonly-text">{snapshot.generatedBrief}</div>}
      </div>}
      <footer className="brief-library-footer">
        <div><button ref={infoButton} className="secondary-button" onClick={() => setShowInfo(true)} aria-label={`Info for ${title}`}><Info size={15} /> Info</button><time dateTime={record.createdAt}>{date}</time></div>
        <button className="brief-delete" onClick={onDelete} disabled={state === "generating"} aria-label={`Delete ${title}`}><Trash2 size={15} /> Delete</button>
      </footer>
      <dialog ref={dialog} className="brief-info-dialog" aria-labelledby={`brief-info-title-${record.id}`} onCancel={event => { event.preventDefault(); close(); }} onClose={() => { setShowInfo(false); infoButton.current?.focus(); }}>
        <header><div><span>Creative Brief · {label}</span><h2 id={`brief-info-title-${record.id}`}>{title}</h2></div></header>
        <div className="brief-info-body">
          <section><h3>Creative brief</h3><div className={`brief-readonly-text ${state === "failed" ? "brief-error" : ""}`}>{ready ? snapshot.generatedBrief : state === "generating" ? "Generation is in progress." : record.error || "This brief has no finished result."}</div></section>
          <section><h3>Your settings</h3><dl>{settings.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value || "Not specified"}</dd></div>)}</dl></section>
          <section><h3>Used in Story Studio</h3>{stories.length ? <ul>{stories.map(story => <li key={story.id}><b>{story.name}</b><time dateTime={story.createdAt}>{new Date(story.createdAt).toLocaleDateString()}</time></li>)}</ul> : <p>This brief has not been used in a saved Story Studio yet.</p>}</section>
        </div>
        <footer><button className="secondary-button" onClick={close} autoFocus><X size={15} /> Close</button><button className="primary-button" onClick={next} disabled={!ready}>Create Story Studio <ArrowRight size={15} /></button></footer>
      </dialog>
    </article>
  );
}
