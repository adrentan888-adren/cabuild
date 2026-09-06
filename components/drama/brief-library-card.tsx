"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ChevronDown, Info, LoaderCircle, Trash2, X, Star, SlidersHorizontal, BookOpen, FileText } from "lucide-react";
import { PageArtwork } from "@/components/page-intro";
import type { WorkflowRecord } from "./drama-studio";

export default function BriefLibraryCard({ record, stories, onUse, onDelete, onToggleFavorite, children }: {
  record: WorkflowRecord;
  stories: WorkflowRecord[];
  onUse: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const infoButton = useRef<HTMLButtonElement>(null);
  const snapshot = record.snapshot;
  const isStory = record.stage === 2;
  const itemLabel = isStory ? "Story Studio" : "Creative Brief";
  const result = isStory ? snapshot.storyline : snapshot.generatedBrief;
  const state = record.status ?? (result.trim() ? "ready" : "failed");
  const nextLabel = isStory ? "Generate & Edit" : "Create Story Studio";
  const nextAvailable = !isStory || snapshot.scenes.some(scene => scene.prompt.trim());
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
    <article className={`stage-record-card brief-library-card ${isStory ? "story-library-card" : ""} ${expanded ? "expanded" : "collapsed"}`}>
      <header className="brief-library-header">
        <button className="brief-favorite" onClick={onToggleFavorite} aria-label={`${record.favorite ? "Remove" : "Add"} ${title} ${record.favorite ? "from" : "to"} favorites`} aria-pressed={Boolean(record.favorite)}><Star size={20} fill={record.favorite ? "currentColor" : "none"} /></button>
        <h3 className="brief-title-heading" aria-label={title}><button className="brief-title-toggle" onClick={() => setExpanded(!expanded)} aria-label={`${expanded ? "Collapse" : "Expand"} ${title}`} aria-expanded={expanded} aria-controls={`brief-content-${record.id}`}><span>{title}</span><ChevronDown size={20} /></button></h3>
        <span className={`status-pill brief-status-${state}`} role="status">{state === "generating" && <LoaderCircle size={13} className="brief-status-spinner" />}{label}</span>
        <div className="brief-library-actions">
          <button className="secondary-button" onClick={onUse} disabled={!ready || !nextAvailable} title={isStory ? "Prepare episode scene prompts below, then open Generate & Edit." : "Use this brief to set up a Story Studio. Generation starts only when you choose Generate there."}>{nextLabel} <ArrowRight size={15} /></button>
        </div>
      </header>
      {expanded && <div id={`brief-content-${record.id}`} className="brief-library-content">
        {state === "generating" ? <p>Generating your {itemLabel.toLowerCase()}. You can leave this page and return to check its progress.</p> : state === "failed" ? <p className="brief-error">{record.error || "This brief has no finished result."}</p> : children || <div className="brief-readonly-text">{result}</div>}
      </div>}
      <footer className="brief-library-footer">
        <div><button ref={infoButton} className="secondary-button" onClick={() => setShowInfo(true)} aria-label={`Info for ${title}`}><Info size={15} /> Info</button><time dateTime={record.createdAt}>{date}</time></div>
        <button className="brief-delete" onClick={onDelete} disabled={state === "generating"} aria-label={`Delete ${title}`}><Trash2 size={15} /> Delete</button>
      </footer>
      <dialog ref={dialog} className="brief-info-dialog" onClick={event => { if (event.target !== event.currentTarget) return; const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close(); }} aria-labelledby={`brief-info-title-${record.id}`} onCancel={event => { event.preventDefault(); close(); }} onClose={() => { setShowInfo(false); infoButton.current?.focus(); }}>
        <header className="theme-lilac"><div><span className="page-intro-kicker">{itemLabel} · {label}</span><h2 id={`brief-info-title-${record.id}`}>{title}</h2></div><PageArtwork kind="story" /></header>
        <div className="brief-info-body">
          <section className="brief-info-section"><h3><FileText size={18} /> {isStory ? "Season storyline" : "Creative brief"}</h3><div className={`brief-readonly-text ${state === "failed" ? "brief-error" : ""}`}>{ready ? result : state === "generating" ? "Generation is in progress." : record.error || "This brief has no finished result."}</div></section>
          {isStory && <section className="brief-info-section"><h3><FileText size={18}/> Submitted brief</h3><div className="brief-readonly-text">{snapshot.generatedBrief}</div></section>}
          <section className="brief-info-section"><h3><SlidersHorizontal size={18} /> Your settings</h3><dl>{settings.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value || "Not specified"}</dd></div>)}</dl></section>
          {!isStory && <section className="brief-info-section"><h3><BookOpen size={18} /> Used in Story Studio</h3>{stories.length ? <ul>{stories.map(story => <li key={story.id}><b>{story.name}</b><time dateTime={story.createdAt}>{new Date(story.createdAt).toLocaleDateString()}</time></li>)}</ul> : <p>This brief has not been used in a saved Story Studio yet.</p>}</section>}
        </div>
        <footer><button className="secondary-button" onClick={close} autoFocus><X size={15} /> Close</button><button className="primary-button" onClick={next} disabled={!ready || !nextAvailable}>{nextLabel} <ArrowRight size={15} /></button></footer>
      </dialog>
    </article>
  );
}
