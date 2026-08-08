"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Download, Film, Plus, RefreshCcw, RotateCcw, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
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
  const polling = Boolean(project && ["queued", "generating", "partially_failed", "combining"].includes(project.status) && project.scenes.some((scene) => scene.providerTaskId && !["completed", "failed", "cancelled"].includes(scene.status)));
  useEffect(() => {
    if (!polling || !project || pollRef.current) return;
    const poll = async () => {
      if (pollRef.current) return;
      pollRef.current = true;
      try { const result = await ugcApi({ action: "poll", projectId: project.id }); setProject(result.project); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Progress check failed."); } finally { pollRef.current = false; }
    };
    void poll();
    const timer = window.setInterval(poll, 8000);
    return () => window.clearInterval(timer);
  }, [polling, project?.id]);

  const run = async (label: string, payload: Record<string, unknown>) => {
    setBusy(label); setMessage(label === "storyboard" ? "GPT-5.5 is preparing the storyboard..." : label === "generate" ? "Submitting approved scenes to Seedance 2.0..." : label === "combine" ? "Combining completed scenes into the final MP4..." : "Saving changes...");
    try { const result = await ugcApi(payload); if (result.project) setProject(result.project); await load(); setMessage(label === "storyboard" ? "Storyboard ready. Review every scene and the cost before generating." : label === "generate" ? "Generation started. You can leave this page and return later." : label === "combine" ? "Final UGC video is ready." : "Changes saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Operation failed."); }
    finally { setBusy(""); }
  };

  return <div className="video-template-page">
    <div className="video-template-head"><div><span className="module-kicker">Video Template</span><h2>Reusable video workflows</h2><p>Create structured videos while keeping every project, scene, and output in your account.</p></div>{!project && !creating && <button className="primary" onClick={() => setCreating(true)}><Plus size={16} />New UGC video</button>}</div>
    <div className="video-template-tabs"><button className="active"><Film size={15} />UGC Video</button></div>
    {message && <div className="generation-notice">{message}</div>}
    {!project && !creating && <ProjectList projects={projects} onOpen={setProject} onNew={() => setCreating(true)} onDelete={async (id) => { if (!window.confirm("Delete this UGC project?")) return; await ugcApi({ action: "delete", projectId: id }); await load(); }} />}
    {!project && creating && <NewProject busy={Boolean(busy)} onCancel={() => setCreating(false)} onCreated={(next) => { setProject(next); setCreating(false); void load(); }} setMessage={setMessage} />}
    {project && <ProjectEditor project={project} busy={busy} setProject={setProject} onBack={() => { setProject(null); void load(); }} run={run} />}
  </div>;
}

function ProjectList({ projects, onOpen, onNew, onDelete }: { projects: UgcVideoProject[]; onOpen: (project: UgcVideoProject) => void; onNew: () => void; onDelete: (id: string) => void }) {
  if (!projects.length) return <div className="ugc-empty"><Film size={32} /><h3>No UGC videos yet</h3><p>Create a project from a product image, review its storyboard, and generate each approved scene.</p><button className="primary" onClick={onNew}><Plus size={15} />Create UGC video</button></div>;
  return <div className="ugc-project-list">{projects.map((item) => <article className="ugc-project-row" key={item.id}>
    <button className="ugc-project-thumb" onClick={() => onOpen(item)}>{item.sourceImageUrl ? <img src={item.sourceImageUrl} alt="" /> : <Film size={22} />}</button>
    <button className="ugc-project-copy" onClick={() => onOpen(item)}><strong>{item.productName}</strong><span>{item.style} · {item.language} · {item.targetDuration}s</span><small>Updated {new Date(item.updatedAt).toLocaleString()}</small></button>
    <div className="ugc-project-meta"><span className={`status ${item.status}`}>{item.status.replace(/_/g, " ")}</span><b>${item.estimatedTotalCostUsd.toFixed(2)} est.</b></div>
    <button className="icon-btn" title="Delete project" disabled={["queued", "generating", "combining"].includes(item.status)} onClick={() => void onDelete(item.id)}><Trash2 size={15} /></button>
  </article>)}</div>;
}

function NewProject({ busy, onCancel, onCreated, setMessage }: { busy: boolean; onCancel: () => void; onCreated: (project: UgcVideoProject) => void; setMessage: (value: string) => void }) {
  const [file, setFile] = useState<File | null>(null); const [preview, setPreview] = useState("");
  const submit = async (form: FormData) => {
    if (!file) return setMessage("Upload a JPG, PNG, or WebP product image first.");
    const productName = String(form.get("productName") || "").trim(); if (!productName) return setMessage("Product name is required.");
    setMessage("Uploading the product image and creating your project...");
    try {
      const upload = new FormData(); upload.set("role", "product photo"); upload.set("file", file);
      const response = await fetch("/api/uploads", { method: "POST", body: upload }); const uploaded = await response.json() as UploadResult & { error?: string }; if (!response.ok) throw new Error(uploaded.error || "Upload failed.");
      const result = await ugcApi({ action: "create", productName, sellingPoints: form.get("sellingPoints"), audience: form.get("audience"), style: form.get("style"), language: form.get("language"), targetDuration: Number(form.get("targetDuration")), sourceImageUrl: uploaded.url, sourceImageStorageKey: uploaded.storageKey });
      onCreated(result.project); setMessage("Project created. Build the storyboard when the details are ready.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create project."); }
  };
  return <form className="ugc-setup" action={(form) => void submit(form)}><div className="ugc-step-head"><div><span>Step 1</span><h3>Product and creative direction</h3></div><button type="button" onClick={onCancel}>Cancel</button></div>
    <div className="ugc-setup-grid"><label className={`product-drop ${preview ? "selected" : ""}`}><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const next = event.target.files?.[0] || null; setFile(next); if (preview) URL.revokeObjectURL(preview); setPreview(next ? URL.createObjectURL(next) : ""); }} />{preview ? <img src={preview} alt="Product preview" /> : <><Upload size={26} /><b>Upload product image</b><small>JPG, PNG or WebP · up to 20 MB</small></>}</label>
      <div className="ugc-fields"><label>Product name<input name="productName" maxLength={120} required /></label><label>Selling points and restrictions<textarea name="sellingPoints" maxLength={3000} placeholder="Facts to emphasize and claims to avoid" /></label><label>Target audience<input name="audience" maxLength={1000} /></label><div className="ugc-field-row"><label>Style<select name="style"><option>UGC product demo</option><option>Problem-solution ad</option><option>Cinematic product ad</option><option>Talking-head review</option><option>Unboxing</option><option>Stop motion</option></select></label><label>Language<select name="language"><option>English</option><option>Malay</option><option>Mandarin</option></select></label><label>Duration<select name="targetDuration"><option value="8">8 seconds</option><option value="20">20 seconds</option><option value="30">30 seconds</option></select></label></div><button className="primary" disabled={busy}><Check size={15} />Create project</button></div></div>
  </form>;
}

function ProjectEditor({ project, busy, setProject, onBack, run }: { project: UgcVideoProject; busy: string; setProject: (value: UgcVideoProject) => void; onBack: () => void; run: (label: string, payload: Record<string, unknown>) => Promise<void> }) {
  const completed = project.scenes.filter((scene) => scene.status === "completed").length;
  const canGenerate = project.scenes.length > 0 && !project.scenes.some((scene) => scene.providerTaskId);
  const canCombine = project.scenes.length > 0 && completed === project.scenes.length && !project.finalVideoUrl;
  const saveScenes = () => run("save", { action: "update", projectId: project.id, scenes: project.scenes });
  const updateScene = (id: string, patch: Partial<UgcVideoScene>) => setProject({ ...project, scenes: project.scenes.map((scene) => scene.id === id ? { ...scene, ...patch } : scene) });
  return <div className="ugc-editor"><div className="ugc-editor-bar"><button onClick={onBack}><ArrowLeft size={15} />All projects</button><div><strong>{project.productName}</strong><span>{project.style} · {project.targetDuration}s · {project.language}</span></div><span className={`status ${project.status}`}>{project.status.replace(/_/g, " ")}</span></div>
    <div className="ugc-progress"><span className="done">1 Product</span><i /><span className={project.scenes.length ? "done" : "active"}>2 Storyboard</span><i /><span className={project.scenes.some((scene) => scene.providerTaskId) ? "done" : ""}>3 Cost & generate</span><i /><span className={project.finalVideoUrl ? "done" : ""}>4 Final video</span></div>
    {!project.scenes.length && <section className="ugc-focus"><img src={project.sourceImageUrl} alt="Product" /><div><span>Storyboard preparation</span><h3>Turn the approved product facts into editable scenes</h3><p>GPT-5.5 will create a scene-based UGC storyboard. This does not start paid video generation.</p><button className="primary" disabled={Boolean(busy)} onClick={() => void run("storyboard", { action: "storyboard", projectId: project.id })}><Sparkles size={15} />{busy === "storyboard" ? "Building storyboard..." : "Build storyboard with GPT-5.5"}</button></div></section>}
    {project.scenes.length > 0 && <><section className="ugc-storyboard"><div className="ugc-section-title"><div><span>Step 2</span><h3>Review storyboard</h3><p>Edit and save every scene before confirming paid generation.</p></div><button disabled={Boolean(busy) || !canGenerate} onClick={() => void saveScenes()}><Check size={14} />Save edits</button></div><div className="ugc-scenes">{project.scenes.sort((a, b) => a.order - b.order).map((scene) => <article key={scene.id}><div className="ugc-scene-top"><b>Scene {scene.order}</b><label><input type="number" min="4" max="15" value={scene.duration} disabled={!canGenerate} onChange={(event) => updateScene(scene.id, { duration: Number(event.target.value) })} /> sec</label></div><input value={scene.title} disabled={!canGenerate} onChange={(event) => updateScene(scene.id, { title: event.target.value })} /><textarea value={scene.prompt} disabled={!canGenerate} onChange={(event) => updateScene(scene.id, { prompt: event.target.value })} /><label>Spoken dialogue<textarea value={scene.dialogue || ""} disabled={!canGenerate} onChange={(event) => updateScene(scene.id, { dialogue: event.target.value })} /></label>{scene.outputUrl && <video src={scene.outputUrl} controls playsInline />}{scene.providerTaskId && <div className="ugc-scene-status"><span className={`status ${scene.status}`}>{scene.status}</span><span>{scene.progress || 0}%</span>{["failed", "completed"].includes(scene.status) && <button disabled={Boolean(busy)} onClick={() => void run("retry", { action: "retry", projectId: project.id, sceneId: scene.id })}><RotateCcw size={13} />Regenerate</button>}</div>}{scene.error && <small className="provider-error">{scene.error}</small>}</article>)}</div></section>
      {canGenerate && <section className="ugc-cost"><div><span>Step 3</span><h3>Review estimated provider cost</h3><p>This calls Kie directly and does not deduct Content Agent credits.</p></div><div className="ugc-cost-breakdown"><span>Storyboard estimate <b>${project.estimatedStoryboardCostUsd.toFixed(2)}</b></span><span>{project.scenes.length} scenes · {project.scenes.reduce((sum, scene) => sum + scene.duration, 0)} generated seconds <b>${project.estimatedVideoCostUsd.toFixed(2)}</b></span><strong>Estimated total <b>${project.estimatedTotalCostUsd.toFixed(2)}</b></strong><button className="primary" disabled={Boolean(busy)} onClick={() => { if (window.confirm(`Generate ${project.scenes.length} scenes for an estimated $${project.estimatedVideoCostUsd.toFixed(2)} provider cost?`)) void run("generate", { action: "generate", projectId: project.id, confirmed: true, idempotencyKey: crypto.randomUUID() }); }}><Wand2 size={15} />{busy === "generate" ? "Starting generation..." : "Confirm and generate"}</button></div></section>}
      {project.scenes.some((scene) => scene.providerTaskId) && <section className="ugc-generation"><div className="ugc-section-title"><div><span>Generation progress</span><h3>{completed}/{project.scenes.length} scenes completed</h3><p>You may leave this page. Progress is stored and will resume when you return.</p></div><button disabled={Boolean(busy)} onClick={() => void run("poll", { action: "poll", projectId: project.id })}><RefreshCcw size={14} />Check now</button></div>{canCombine && <button className="primary" disabled={Boolean(busy)} onClick={() => void run("combine", { action: "combine", projectId: project.id })}><Film size={15} />Combine final MP4</button>}</section>}
    </>}
    {project.finalVideoUrl && <section className="ugc-final"><div><span>Final video</span><h3>{project.productName}</h3><p>All approved scenes combined in storyboard order.</p><a className="primary" href={project.finalVideoUrl} download><Download size={15} />Download final MP4</a></div><video src={project.finalVideoUrl} controls playsInline /></section>}
  </div>;
}
