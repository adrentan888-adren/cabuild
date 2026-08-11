"use client";

import { useEffect, useMemo, useState } from "react";

type Scene = { title: string; duration: number; prompt: string };
type Result = { scene: number; taskId: string; state: string; assetUrl?: string; error?: string };

async function api(payload: Record<string, unknown>) {
  const response = await fetch("/api/kie", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || "Request failed.");
  return json;
}

export default function Page() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [productName, setProductName] = useState("");
  const [sellingPoints, setSellingPoints] = useState("");
  const [audience, setAudience] = useState("");
  const [style, setStyle] = useState("UGC product demo");
  const [language, setLanguage] = useState("Malay");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const duration = 15;
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const completed = useMemo(() => results.filter((item) => item.state === "success").length, [results]);
  const storyboardDuration = useMemo(() => scenes.reduce((total, scene) => total + (Number(scene.duration) || 0), 0), [scenes]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    if (!results.some((item) => !["success", "fail"].includes(item.state))) return;
    const timer = window.setInterval(async () => {
      const next = await Promise.all(results.map(async (item) => {
        if (["success", "fail"].includes(item.state)) return item;
        try {
          const status = await api({ action: "status", taskId: item.taskId });
          return { ...item, state: status.state, assetUrl: status.assetUrl, error: status.error };
        } catch (error) {
          return { ...item, error: error instanceof Error ? error.message : "Status failed." };
        }
      }));
      setResults(next);
      if (next.every((item) => ["success", "fail"].includes(item.state))) setMessage("Generation finished. Review the complete video below.");
    }, 8000);
    return () => window.clearInterval(timer);
  }, [results]);

  const chooseFile = (next?: File) => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(next || null);
    setPreview(next ? URL.createObjectURL(next) : "");
  };

  const buildPlan = async () => {
    if (!file || !productName.trim()) return setMessage("Add a product image and product name first.");
    setBusy("plan");
    setMessage("GPT-5.5 is creating the storyboard...");
    try {
      const response = await api({ action: "plan", productName, sellingPoints, audience, style, language, aspectRatio });
      const plannedScenes = Array.isArray(response.plan?.scenes) ? response.plan.scenes : [];
      setScenes(plannedScenes.map((scene: Scene, index: number) => ({
        title: String(scene.title || `Scene ${index + 1}`),
        duration: Number(scene.duration) > 0 ? Number(scene.duration) : 5,
        prompt: String(scene.prompt || "")
      })));
      setMessage("Storyboard ready. Edit any scene before starting Seedance 2.0.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Planning failed.");
    } finally {
      setBusy("");
    }
  };

  const generate = async () => {
    if (!file || !scenes.length) return;
    if (Math.abs(storyboardDuration - duration) > 0.001) return setMessage(`Scene durations must total exactly ${duration} seconds. Current total: ${storyboardDuration} seconds.`);
    setBusy("video");
    try {
      setMessage("Uploading product reference to KIE...");
      const form = new FormData();
      form.set("file", file);
      const upload = await fetch("/api/kie", { method: "POST", body: form });
      const uploaded = await upload.json();
      if (!upload.ok) throw new Error(uploaded.error || "Upload failed.");
      let elapsed = 0;
      const timeline = scenes.map((scene, index) => {
        const start = elapsed;
        elapsed += Number(scene.duration);
        return `Scene ${index + 1} — ${start.toFixed(1)}s to ${elapsed.toFixed(1)}s (${scene.duration}s) — ${scene.title}: ${scene.prompt}`;
      }).join("\n");
      setMessage("Starting one 15-second Seedance video...");
      const response = await api({
        action: "start",
        referenceUrl: uploaded.url,
        duration,
        aspectRatio,
        prompt: `${style}, ${aspectRatio} aspect ratio. Create one continuous 15-second product video following this exact time-coded storyboard:\n${timeline}
Dialogue language: ${language}. Follow the scene timings and transitions precisely while maintaining visual continuity. Use the attached product image as the sole source of truth. Preserve its exact packaging, logo, colors, shape and proportions throughout the entire video. Natural movement and lighting. No generated captions, overlays, invented labels, watermarks, or extra readable text.`
      });
      setResults([{ scene: 1, taskId: response.taskId, state: "waiting" }]);
      setMessage("The complete 15-second video was accepted by KIE and is generating.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Generation failed.");
    } finally {
      setBusy("");
    }
  };

  return (
    <main>
      <header><div className="logo">PV</div><div><span>DIRECT KIE WORKFLOW</span><h1>Product Video Studio</h1><p>Product image → GPT‑5.5 storyboard → one Seedance 2.0 video</p></div></header>
      <section className="progress"><div className="on"><b>1</b><span>Product</span></div><i /><div className={scenes.length ? "on" : ""}><b>2</b><span>Storyboard</span></div><i /><div className={results.length ? "on" : ""}><b>3</b><span>Generate</span></div><i /><div className={completed ? "on" : ""}><b>4</b><span>Review</span></div></section>

      <section className="setup">
        <article className="card">
          <div className="step"><b>1</b><span>Product details</span></div>
          <label className={`drop ${preview ? "selected" : ""}`}><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => chooseFile(event.target.files?.[0])} />{preview ? <img src={preview} alt="Product preview" /> : <><strong>Upload product image</strong><small>PNG, JPG or WebP · maximum 15 MB</small></>}</label>
          <label>Product name<input value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="JUVEX Energy Plus" /></label>
          <label>Selling points and restrictions<textarea value={sellingPoints} onChange={(event) => setSellingPoints(event.target.value)} placeholder="Benefits to emphasize and claims to avoid..." /></label>
          <label>Target audience<input value={audience} onChange={(event) => setAudience(event.target.value)} placeholder="Who should this video speak to?" /></label>
        </article>
        <article className="card">
          <div className="step"><b>2</b><span>Creative direction</span></div>
          <label>Style<select value={style} onChange={(event) => setStyle(event.target.value)}><option>UGC product demo</option><option>Problem–solution ad</option><option>Cinematic product ad</option><option>Talking-head review</option><option>Unboxing</option><option>Stop motion</option></select></label>
          <label>Dialogue language<select value={language} onChange={(event) => setLanguage(event.target.value)}><option>Malay</option><option>English</option><option>Mandarin</option></select></label>
          <label>Video duration<input value="15 seconds" disabled /></label>
          <label>Video dimensions<select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}><option value="9:16">9:16 · Portrait</option><option value="16:9">16:9 · Landscape</option><option value="1:1">1:1 · Square</option></select></label>
          <div className="model"><span>Planner</span><b>GPT‑5.5</b><span>Video</span><b>Seedance 2.0</b></div>
          <button onClick={() => void buildPlan()} disabled={Boolean(busy)}>{busy === "plan" ? "GPT‑5.5 is planning…" : "Build storyboard with GPT‑5.5"}</button>
          <small className="note">KIE is called directly. No ContentAgent credits are used.</small>
        </article>
      </section>

      {message && <div className="message">{message}</div>}

      {scenes.length > 0 && <section className="card wide">
        <div className="sectionHead"><div className="step"><b>3</b><span>Review storyboard · {storyboardDuration}/15 seconds</span></div><button onClick={() => void generate()} disabled={Boolean(busy) || Math.abs(storyboardDuration - duration) > 0.001}>{busy === "video" ? "Starting video…" : "Generate one 15-second video"}</button></div>
        <div className="sceneGrid">{scenes.map((scene, index) => <article className="scene" key={index}><div className="sceneTop"><b>Scene {index + 1}</b><span>{aspectRatio}</span></div><input value={scene.title} onChange={(event) => setScenes((current) => current.map((item, i) => i === index ? { ...item, title: event.target.value } : item))} /><label>Duration (seconds)<input type="number" min="1" max="13" step="0.5" value={scene.duration} onChange={(event) => setScenes((current) => current.map((item, i) => i === index ? { ...item, duration: Number(event.target.value) } : item))} /></label><textarea value={scene.prompt} onChange={(event) => setScenes((current) => current.map((item, i) => i === index ? { ...item, prompt: event.target.value } : item))} /></article>)}</div>
      </section>}

      {results.length > 0 && <section className="card wide">
        <div className="step"><b>4</b><span>Generated video · {completed}/{results.length} ready</span></div>
        <div className="sceneGrid">{results.map((result) => <article className="scene result" key={result.taskId}>{result.assetUrl ? <video src={result.assetUrl} controls playsInline /> : <div className="waiting">Complete video<span>{result.state}</span></div>}<small>{result.error || result.taskId}</small></article>)}</div>
      </section>}
    </main>
  );
}
