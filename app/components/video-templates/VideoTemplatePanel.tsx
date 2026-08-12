"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Download, Film, Plus, RefreshCcw, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import type { UgcVideoProject, UgcVideoScene } from "@/lib/types";

type UploadResult = { url: string; storageKey: string };

async function ugcApi(payload?: Record<string, unknown>) {
  const response = await fetch("/api/video-templates/ugc", payload ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : { cache: "no-store" });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || "UGC video request failed.");
  return json;
}

export default function VideoTemplatePanel() {
  const [projects, setProjects] = useState<UgcVideoProject[]>([]);
  const [project, setProject] = useState<UgcVideoProject | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const pollRef = useRef(false);

  const load = async () => {
    try {
      const result = await ugcApi();
      setProjects(result.projects || []);
      if (project) setProject((result.projects || []).find((item: UgcVideoProject) => item.id === project.id) || project);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load UGC projects."); }
  };
  useEffect(() => { void load(); }, []);
  const polling = Boolean(project?.workflowVersion === "single_video_v2" && ["queued", "generating"].includes(project.status) && project.providerTaskId);
  useEffect(() => {
    if (!polling || !project || pollRef.current) return;
    const poll = async () => {
      if (pollRef.current) return;
      pollRef.current = true;
      try { const result = await ugcApi({ action: "poll", projectId: project.id }); setProject(result.project); await load(); }
      catch (error) { setMessage(error instanceof Error ? error.message : "Progress check failed."); }
      finally { pollRef.current = false; }
    };
    void poll();
    const timer = window.setInterval(poll, 8000);
    return () => window.clearInterval(timer);
  }, [polling, project?.id]);

  const run = async (label: string, payload: Record<string, unknown>) => {
    setBusy(label);
    setMessage(label === "storyboard" ? "GPT-5.5 is preparing three scenes..." : label === "generate" ? "Submitting one complete 15-second video to Seedance 2.0..." : "Saving changes...");
    try {
      const result = await ugcApi(payload);
      if (result.project) setProject(result.project);
      await load();
      setMessage(label === "storyboard" ? "Storyboard ready. Review the three scenes and make sure they total 15 seconds." : label === "generate" ? "Generation started. You can leave this page and return later." : "Changes saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Operation failed."); }
    finally { setBusy(""); }
  };

  return <div className="video-template-page">
    <div className="video-template-head"><div><span className="module-kicker">Video Template</span><h2>UGC Video</h2><p>Create one continuous 15-second UGC video from an editable, three-scene storyboard.</p></div>{!project && !creating && <button className="primary" onClick={() => setCreating(true)}><Plus size={16} />New UGC video</button>}</div>
    {message && <div className="generation-notice" aria-live="polite">{message}</div>}
    {!project && !creating && <ProjectList projects={projects} onOpen={setProject} onNew={() => setCreating(true)} onDelete={async (projectId) => { if (!window.confirm("Delete this UGC project?")) return; await ugcApi({ action: "delete", projectId }); await load(); }} />}
    {!project && creating && <NewProject busy={Boolean(busy)} onCancel={() => setCreating(false)} onCreated={(next) => { setProject(next); setCreating(false); void load(); }} setMessage={setMessage} />}
    {project && <ProjectEditor project={project} busy={busy} setProject={setProject} onBack={() => { setProject(null); void load(); }} run={run} />}
  </div>;
}

function ProjectList({ projects, onOpen, onNew, onDelete }: { projects: UgcVideoProject[]; onOpen: (project: UgcVideoProject) => void; onNew: () => void; onDelete: (id: string) => void }) {
  if (!projects.length) return <div className="ugc-empty"><Film size={32} /><h3>No UGC videos yet</h3><p>Create a project from a product image, review three scenes, then submit one complete video.</p><button className="primary" onClick={onNew}><Plus size={15} />Create UGC video</button></div>;
  return <div className="ugc-project-list">{projects.map((item) => <article className="ugc-project-row" key={item.id}>
    <button className="ugc-project-thumb" onClick={() => onOpen(item)}>{item.sourceImageUrl ? <img src={item.sourceImageUrl} alt="" /> : <Film size={22} />}</button>
    <button className="ugc-project-copy" onClick={() => onOpen(item)}><strong>{item.productName}</strong><span>{item.workflowVersion === "legacy_scene_jobs" ? "Legacy multi-job project" : `${item.style} · ${item.aspectRatio} · 15 seconds`}</span><small>Updated {new Date(item.updatedAt).toLocaleString()}</small></button>
    <div className="ugc-project-meta"><span className={`status ${item.status}`}>{statusLabel(item)}</span><b>${item.estimatedTotalCostUsd.toFixed(2)} est.</b></div>
    <button className="icon-btn" title="Delete project" disabled={["queued", "generating"].includes(item.status)} onClick={() => void onDelete(item.id)}><Trash2 size={15} /></button>
  </article>)}</div>;
}

function NewProject({ busy, onCancel, onCreated, setMessage }: { busy: boolean; onCancel: () => void; onCreated: (project: UgcVideoProject) => void; setMessage: (value: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [aspectRatio, setAspectRatio] = useState<"9:16" | "16:9" | "1:1">("9:16");
  const submit = async (form: FormData) => {
    if (!file) return setMessage("Upload a JPG, PNG, or WebP product image first.");
    const productName = String(form.get("productName") || "").trim();
    if (!productName) return setMessage("Product name is required.");
    setMessage("Uploading the product image and creating your project...");
    try {
      const upload = new FormData(); upload.set("role", "product photo"); upload.set("file", file);
      const response = await fetch("/api/uploads", { method: "POST", body: upload });
      const uploaded = await response.json() as UploadResult & { error?: string };
      if (!response.ok) throw new Error(uploaded.error || "Upload failed.");
      const result = await ugcApi({ action: "create", productName, sellingPoints: form.get("sellingPoints"), audience: form.get("audience"), style: form.get("style"), language: form.get("language"), aspectRatio, sourceImageUrl: uploaded.url, sourceImageStorageKey: uploaded.storageKey });
      onCreated(result.project); setMessage("Project created. Build the storyboard when the details are ready.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create project."); }
  };
  return <form className="ugc-setup" action={(form) => void submit(form)}><div className="ugc-step-head"><div><span>Step 1</span><h3>Product and creative direction</h3></div><button type="button" onClick={onCancel}>Cancel</button></div>
    <div className="ugc-setup-grid"><label className={`product-drop ${preview ? "selected" : ""}`}><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const next = event.target.files?.[0] || null; setFile(next); if (preview) URL.revokeObjectURL(preview); setPreview(next ? URL.createObjectURL(next) : ""); }} />{preview ? <img src={preview} alt="Product preview" /> : <><Upload size={26} /><b>Upload product image</b><small>JPG, PNG or WebP · up to 20 MB</small></>}</label>
      <div className="ugc-fields"><label>Product name<input name="productName" maxLength={120} required /></label><label>Selling points and restrictions<textarea name="sellingPoints" maxLength={3000} placeholder="Facts to emphasize and claims to avoid" /></label><label>Target audience<input name="audience" maxLength={1000} /></label><div className="ugc-field-row"><label>Style<select name="style"><option>UGC product demo</option><option>Problem-solution ad</option><option>Cinematic product ad</option><option>Talking-head review</option><option>Unboxing</option><option>Stop motion</option></select></label><label>Language<select name="language"><option>English</option><option>Malay</option><option>Mandarin</option></select></label><label>Duration<input value="15 seconds" disabled /></label></div><fieldset className="ugc-ratio"><legend>Aspect ratio</legend>{(["9:16", "16:9", "1:1"] as const).map((ratio) => <button type="button" className={aspectRatio === ratio ? "active" : ""} key={ratio} onClick={() => setAspectRatio(ratio)}><span>{ratio}</span><small>{ratio === "9:16" ? "Portrait" : ratio === "16:9" ? "Landscape" : "Square"}</small></button>)}</fieldset><button className="primary" disabled={busy}><Check size={15} />Create project</button></div></div>
  </form>;
}

function ProjectEditor({ project, busy, setProject, onBack, run }: { project: UgcVideoProject; busy: string; setProject: (value: UgcVideoProject) => void; onBack: () => void; run: (label: string, payload: Record<string, unknown>) => Promise<void> }) {
  if (project.workflowVersion === "legacy_scene_jobs") return <LegacyProject project={project} busy={busy} onBack={onBack} run={run} />;
  const total = Math.round(project.scenes.reduce((sum, scene) => sum + Number(scene.duration || 0), 0) * 10) / 10;
  const validTotal = Math.abs(total - 15) < 0.001;
  const running = ["queued", "generating"].includes(project.status);
  const editable = !running;
  const completeScenes = project.scenes.length === 3 && project.scenes.every((scene) => scene.title.trim() && scene.prompt.trim());
  const canGenerate = completeScenes && validTotal && editable;
  const timeline = timelineFor(project.scenes);
  const updateScene = (sceneId: string, patch: Partial<UgcVideoScene>) => setProject({ ...project, scenes: project.scenes.map((scene) => scene.id === sceneId ? { ...scene, ...patch } : scene) });
  const save = () => run("save", { action: "update", projectId: project.id, scenes: project.scenes });
  return <div className="ugc-editor"><div className="ugc-editor-bar"><button onClick={onBack}><ArrowLeft size={15} />All projects</button><div><strong>{project.productName}</strong><span>{project.style} · {project.aspectRatio} · 15 seconds · {project.language}</span></div><span className={`status ${project.status}`}>{statusLabel(project)}</span></div>
    <div className="ugc-progress"><span className="done">1 Product</span><i /><span className={project.scenes.length ? "done" : "active"}>2 Storyboard</span><i /><span className={running || project.finalVideoUrl ? "done" : ""}>3 Generate one video</span><i /><span className={project.finalVideoUrl ? "done" : ""}>4 Final video</span></div>
    {!project.scenes.length && <section className="ugc-focus"><img src={project.sourceImageUrl} alt="Product" /><div><span>Storyboard preparation</span><h3>Create exactly three editable scenes</h3><p>GPT-5.5 will plan one continuous 15-second video. This step does not start paid video generation.</p><button className="primary" disabled={Boolean(busy)} onClick={() => void run("storyboard", { action: "storyboard", projectId: project.id })}><Sparkles size={15} />{busy === "storyboard" ? "Building storyboard..." : "Build storyboard with GPT-5.5"}</button></div></section>}
    {project.scenes.length > 0 && <><section className="ugc-storyboard"><div className="ugc-section-title"><div><span>Step 2</span><h3>Review the 15-second timeline</h3><p>Edit each scene. The three durations must add up to exactly 15 seconds.</p></div><div className={`ugc-duration-total ${validTotal ? "valid" : "invalid"}`}><b>{total}s / 15s</b><small>{validTotal ? "Ready" : total < 15 ? `${Math.round((15 - total) * 10) / 10}s remaining` : `${Math.round((total - 15) * 10) / 10}s over`}</small></div></div>
      <div className="ugc-scenes">{[...project.scenes].sort((a, b) => a.order - b.order).map((scene, index) => <article key={scene.id}><div className="ugc-scene-top"><div><b>Scene {index + 1}</b><small>{formatTime(timeline[index]?.start || 0)}–{formatTime(timeline[index]?.end || 0)} seconds</small></div><label>Duration<input type="number" min="1" max="13" step="0.5" value={scene.duration} disabled={!editable} onChange={(event) => updateScene(scene.id, { duration: Number(event.target.value) })} /> sec</label></div><label>Scene title<input value={scene.title} disabled={!editable} maxLength={100} onChange={(event) => updateScene(scene.id, { title: event.target.value })} /></label><label>Visual and action prompt<textarea value={scene.prompt} disabled={!editable} maxLength={4000} onChange={(event) => updateScene(scene.id, { prompt: event.target.value })} /></label></article>)}</div>
      <div className="ugc-storyboard-actions"><span>{validTotal ? "The timeline is valid for one Seedance request." : "Adjust the durations before generation."}</span><button disabled={Boolean(busy) || !editable} onClick={() => void save()}><Check size={14} />Save edits</button></div></section>
      <section className="ugc-cost"><div><span>Step 3</span><h3>Confirm one complete video</h3><p>One request goes directly to Kie.ai using <b>bytedance/seedance-2</b>. No Content Agent credits are deducted.</p><details><summary>Review final time-coded prompt</summary><pre>{project.combinedPrompt || "Save the edited storyboard to refresh the final prompt."}</pre></details></div><div className="ugc-cost-breakdown"><span>Duration <b>15 seconds</b></span><span>Aspect ratio <b>{project.aspectRatio}</b></span><span>Seedance requests <b>1</b></span><strong>Estimated provider cost <b>${project.estimatedVideoCostUsd.toFixed(2)}</b></strong><button className="primary" disabled={Boolean(busy) || !canGenerate} onClick={() => { if (window.confirm(`Submit one 15-second ${project.aspectRatio} video for an estimated $${project.estimatedVideoCostUsd.toFixed(2)} provider cost?`)) void run("generate", { action: "generate", projectId: project.id, scenes: project.scenes, confirmed: true, idempotencyKey: crypto.randomUUID() }); }}><Wand2 size={15} />{busy === "generate" ? "Starting generation..." : project.generationAttempt ? "Generate another video" : "Confirm and generate"}</button>{!canGenerate && !running && <small>Complete all three scenes and make the total exactly 15 seconds.</small>}</div></section>
    </>}
    {(running || project.providerError) && <section className="ugc-generation"><div className="ugc-section-title"><div><span>Generation progress</span><h3>{project.providerError ? "Generation needs attention" : `Creating one complete video · ${project.providerProgress || 0}%`}</h3><p>You may leave this page. The task, progress, and result are stored in your project.</p></div><button disabled={Boolean(busy)} onClick={() => void run("poll", { action: "poll", projectId: project.id })}><RefreshCcw size={14} />Check now</button></div>{project.providerError && <small className="provider-error">{project.providerError}</small>}</section>}
    {project.finalVideoUrl && <section className="ugc-final"><div><span>Final video</span><h3>{project.productName}</h3><p>One continuous 15-second output generated from the approved timeline.</p><a className="primary" href={project.finalVideoUrl} download><Download size={15} />Download MP4</a></div><video src={project.finalVideoUrl} controls playsInline /></section>}
    {!!project.generationAttempts.length && <section className="ugc-attempts"><div className="ugc-section-title"><div><span>Project history</span><h3>Generation attempts</h3><p>Previous outputs remain available when you generate another version.</p></div></div><div>{[...project.generationAttempts].sort((a, b) => b.attemptNumber - a.attemptNumber).map((attempt) => <article key={attempt.id}><div><b>Attempt {attempt.attemptNumber}</b><span>{new Date(attempt.createdAt).toLocaleString()} · {attempt.aspectRatio} · {attempt.status}</span></div>{attempt.outputUrl ? <><video src={attempt.outputUrl} controls playsInline preload="metadata" /><a href={attempt.outputUrl} download title="Download this attempt"><Download size={15} /></a></> : <span>{attempt.progress || 0}%</span>}</article>)}</div></section>}
  </div>;
}

function LegacyProject({ project, busy, onBack, run }: { project: UgcVideoProject; busy: string; onBack: () => void; run: (label: string, payload: Record<string, unknown>) => Promise<void> }) {
  const outputs = project.scenes.filter((scene) => scene.outputUrl);
  return <div className="ugc-editor"><div className="ugc-editor-bar"><button onClick={onBack}><ArrowLeft size={15} />All projects</button><div><strong>{project.productName}</strong><span>Legacy multi-job project · read only</span></div><span className="status legacy_scene_jobs">Legacy</span></div><section className="ugc-legacy"><Film size={28} /><div><h3>This project used the previous scene-by-scene workflow</h3><p>Its existing outputs are preserved. Duplicate it to create a new project using one 15-second Seedance request.</p><button className="primary" disabled={Boolean(busy)} onClick={() => void run("duplicate", { action: "duplicateLegacy", projectId: project.id })}><Plus size={15} />Duplicate into current workflow</button></div></section>{outputs.length > 0 && <section className="ugc-attempts"><div className="ugc-section-title"><div><span>Preserved history</span><h3>Legacy scene outputs</h3></div></div><div>{outputs.map((scene) => <article key={scene.id}><div><b>Scene {scene.order}: {scene.title}</b><span>{scene.duration}s · {scene.status}</span></div><video src={scene.outputUrl} controls playsInline preload="metadata" /><a href={scene.outputUrl} download><Download size={15} /></a></article>)}</div></section>}</div>;
}

function timelineFor(scenes: UgcVideoScene[]) {
  let elapsed = 0;
  return [...scenes].sort((a, b) => a.order - b.order).map((scene) => { const start = elapsed; elapsed = Math.round((elapsed + Number(scene.duration || 0)) * 10) / 10; return { start, end: elapsed }; });
}

function formatTime(value: number) { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function statusLabel(project: UgcVideoProject) { return project.workflowVersion === "legacy_scene_jobs" ? "legacy" : project.status.replace(/_/g, " "); }
