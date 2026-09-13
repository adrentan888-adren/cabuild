"use client";

import Image from "next/image";
import { useState } from "react";
import { ArrowRight, Clapperboard, FileText, ImageIcon, Play, Radar, RefreshCcw, Sparkles, Wand2 } from "lucide-react";
import type { Asset, PublishItem } from "@/lib/types";

type Result = { id: string; title: string; type: string; url?: string; caption?: string; createdAt: string };
type WelcomeData = { user: { name: string }; assets: Asset[]; publishQueue: PublishItem[] };

function ConceptArt({ kind }: { kind: "social" | "drama" | "text" }) {
  return <svg viewBox="0 0 400 280" fill="none" aria-hidden="true" className={`welcome-concept-art ${kind}`}>
    {kind === "social" ? <>
      <rect width="400" height="280" fill="#dce7d9" /><circle cx="310" cy="68" r="105" fill="#c0d0b7" />
      <path d="M0 236C99 177 245 265 400 190V280H0Z" fill="#a6bd9d" />
      <ellipse cx="200" cy="244" rx="72" ry="12" fill="#819b76" opacity=".35" />
      <rect x="157" y="83" width="86" height="151" rx="22" fill="#f7f3df" /><rect x="170" y="58" width="60" height="34" rx="8" fill="#374e40" />
      <path d="M184 126c28 1 37 18 17 37-23-2-30-20-17-37Z" fill="#79946c" /><path d="M199 148v31" stroke="#374e40" strokeWidth="3" />
      <path d="M178 199h44M187 209h26" stroke="#7f8a70" strokeWidth="3" strokeLinecap="round" />
      <path d="m81 75 4 12 13 3-13 4-4 13-3-13-13-4 13-3Z" fill="#fffdf1" />
    </> : kind === "drama" ? <>
      <rect width="400" height="280" fill="#242839" /><circle cx="286" cy="75" r="41" fill="#e9cf9e" />
      <path d="M0 189 75 107 163 186 237 140 400 219V280H0Z" fill="#50516e" /><path d="m0 236 151-83 142 90 107-57v94H0Z" fill="#373d54" />
      <path d="m191 280 55-110 31 110" fill="#9f7891" opacity=".5" /><circle cx="244" cy="172" r="8" fill="#181e2e" /><path d="m237 179-8 40h29l-9-40Z" fill="#181e2e" />
      <path d="M39 33h25M39 33v25M361 33h-25M361 33v25M39 247h25M39 247v-25M361 247h-25M361 247v-25" stroke="#fff" strokeOpacity=".45" strokeWidth="2" />
    </> : <>
      <rect width="400" height="280" fill="#eee5d8" /><rect x="73" y="28" width="254" height="245" rx="12" fill="#fffaf3" transform="rotate(-5 200 140)" />
      <path d="M118 81h64M118 106h165M118 119h138" stroke="#333b36" strokeWidth="7" strokeLinecap="round" />
      <path d="M118 153h165M118 170h149M118 187h158" stroke="#c1b9ab" strokeWidth="5" strokeLinecap="round" /><rect x="115" y="213" width="79" height="20" rx="10" fill="#dce7d9" />
      <circle cx="310" cy="56" r="27" fill="#8a9e87" /><path d="m297 56 9 9 16-19" stroke="white" strokeWidth="3" strokeLinecap="round" />
    </>}
  </svg>;
}

function ResultPreview({ result }: { result: Result }) {
  const [unavailable, setUnavailable] = useState(false);
  const isVideo = result.type === "video" || result.type === "ugc";
  if (result.url && !unavailable && result.type !== "text") return isVideo
    ? <video src={result.url} controls playsInline preload="none" aria-label={result.title} onError={() => setUnavailable(true)} />
    : <Image src={result.url} alt={result.title} width={600} height={420} unoptimized onError={() => setUnavailable(true)} />;
  return <div className="welcome-result-fallback"><FileText size={28} /><p>{unavailable ? "Preview unavailable. Open My Contents to inspect this output." : result.caption || result.title}</p></div>;
}

export default function WelcomeHome({ data, onNavigate, onDrama }: { data: WelcomeData; onNavigate: (page: string) => void; onDrama: () => void }) {
  const readyAssets = data.assets.filter(asset => asset.status === "ready" && (asset.assetUrl || asset.type === "text"));
  const assetIds = new Set(readyAssets.map(asset => asset.id));
  const results: Result[] = [
    ...readyAssets.map(asset => ({ id: asset.id, title: asset.title, type: asset.type, url: asset.assetUrl, caption: data.publishQueue.find(item => item.assetId === asset.id)?.caption, createdAt: asset.createdAt })),
    ...data.publishQueue.filter(item => !assetIds.has(item.assetId) && ["done", "published", "scheduled"].includes(item.status) && (item.assetUrl || item.generationType === "text" && item.caption)).map(item => ({ id: item.id, title: item.title, type: item.generationType || "video", url: item.assetUrl, caption: item.caption, createdAt: item.createdAt || item.scheduledAt }))
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const examples = [
    { kind: "social" as const, label: "Brand & product", title: "Make your product the story", detail: "Product images, social videos and campaign visuals.", icon: ImageIcon },
    { kind: "drama" as const, label: "Scenes & episodes", title: "Bring a story into focus", detail: "Scene clips, recurring characters and episodic stories.", icon: Clapperboard },
    { kind: "text" as const, label: "Captions & copy", title: "Find the words that fit", detail: "On-brand text, captions and social post ideas.", icon: FileText }
  ];
  const steps = [
    { title: "Find your angle", detail: "Set your brand voice and explore proven content ideas.", icon: Radar, page: "research", action: "Explore Research" },
    { title: "Make it yours", detail: "Turn a prompt or a story into images, video or text.", icon: Wand2, page: "create", action: "Open Create Content" },
    { title: "Review the result", detail: "Preview your output, refine the direction and download.", icon: Play, page: "publish", action: "Open My Contents" },
    { title: "Keep it going", detail: "Set up repeatable workflows with your review preferences.", icon: RefreshCcw, page: "automation", action: "Explore Automation" }
  ];
  return <div className="home-panel welcome-page">
    <section className="welcome-hero">
      <div className="welcome-hero-copy">
        <span className="welcome-eyebrow"><span /> Welcome to Content Agent</span>
        <h1>Your next idea.<br /><em>Ready for the world.</em></h1>
        <p>Create social content and cinematic stories in one place. Go from research to a finished image, video or post—with AI to help along the way.</p>
        <div className="welcome-hero-actions"><button className="primary" onClick={() => onNavigate("create")}>Start creating <ArrowRight size={16} /></button><a href="#welcome-workflows">See how it works <span aria-hidden="true">↓</span></a></div>
        <div className="welcome-format-list"><span><ImageIcon size={14} /> Images</span><span><Clapperboard size={14} /> Video</span><span><FileText size={14} /> Text</span></div>
      </div>
      <div className="welcome-hero-visual" aria-label="Illustration of an idea becoming social content and a film scene">
        <div className="welcome-orbit" /><div className="welcome-idea-note"><Sparkles size={15} /><span>One idea. Many possibilities.</span></div>
        <div className="welcome-art-card product"><ConceptArt kind="social" /><span><ImageIcon size={13} /> A fresh perspective</span></div>
        <div className="welcome-art-card scene"><ConceptArt kind="drama" /><span><Clapperboard size={13} /> A story worth telling</span></div>
        <span className="welcome-visual-caption">Illustrative concepts</span>
      </div>
    </section>

    <section className="welcome-paths" aria-labelledby="welcome-paths-title">
      <div className="welcome-section-heading"><div><span className="welcome-eyebrow">Two ways to create</span><h2 id="welcome-paths-title">A space for every kind of idea.</h2></div><p>Start where it makes sense for you.</p></div>
      <div className="welcome-path-grid">
        <article className="welcome-path normal"><div className="welcome-path-symbol"><Sparkles size={25} /><span>01 / SOCIAL</span></div><h3>Content Creator</h3><p>Everyday content, made with your brand in mind. Research an idea, create an asset and keep your publishing routine moving.</p><div className="welcome-tool-tags"><span>Persona</span><span>Research</span><span>Image · Video · Text</span><span>Automation</span></div><button onClick={() => onNavigate("persona")}>Explore Content Creator <ArrowRight size={16} /></button></article>
        <article className="welcome-path drama"><div className="welcome-path-symbol"><Clapperboard size={25} /><span>02 / STORY</span></div><h3>Drama Studio</h3><p>Build characters, scenes and episodes. Follow the creative steps, or jump straight to video with your own scene prompts.</p><div className="welcome-tool-tags"><span>Creative brief</span><span>Story & scenes</span><span>Video clips</span><span>Asset library</span></div><button onClick={onDrama}>Explore Drama Studio <ArrowRight size={16} /></button></article>
      </div>
    </section>

    <section id="welcome-workflows" className="welcome-workflows" aria-labelledby="welcome-workflow-title">
      <div className="welcome-section-heading"><div><span className="welcome-eyebrow">From spark to screen</span><h2 id="welcome-workflow-title">Your creative process, connected.</h2></div><p>A flexible path. You can start at any stage.</p></div>
      <ol className="welcome-pipeline">{steps.map(({title, detail, icon: Icon, page, action}, i) => <li key={page}><div className="welcome-step-top"><span className="welcome-step-icon"><Icon size={22} /></span><span className="welcome-step-number">0{i+1}</span></div><h3>{title}</h3><p>{detail}</p><button className="text-link" onClick={() => onNavigate(page)}>{action}<ArrowRight size={14} /></button></li>)}</ol>
    </section>

    <section className="welcome-showcase" aria-labelledby="welcome-results-title">
      <div className="welcome-section-heading"><div><span className="welcome-eyebrow">{results.length ? "Made in your workspace" : "Imagine the possibilities"}</span><h2 id="welcome-results-title">{results.length ? "Your latest creations." : "What will you make first?"}</h2></div><button className="text-link" onClick={() => onNavigate("publish")}>View My Contents <ArrowRight size={15} /></button></div>
      {results.length ? <div className="welcome-result-grid">{results.slice(0,3).map(result => <article className="welcome-result" key={result.id}><div className="welcome-result-media"><ResultPreview result={result} /></div><div className="welcome-result-copy"><span className="welcome-eyebrow">{result.type} · Created in your workspace</span><h3>{result.title}</h3><button className="text-link" onClick={() => onNavigate("publish")}>Review in My Contents <ArrowRight size={14} /></button></div></article>)}</div> : <><p className="welcome-example-note">Illustrative examples below. Your completed creations will appear here automatically.</p><div className="welcome-result-grid">{examples.map(({kind,label,title,detail,icon: Icon}) => <article className="welcome-result" key={kind}><div className="welcome-result-media"><ConceptArt kind={kind} /><span className="welcome-example-badge">Example</span></div><div className="welcome-result-copy"><span className="welcome-eyebrow"><Icon size={13} />{label}</span><h3>{title}</h3><p>{detail}</p></div></article>)}</div></>}
    </section>
    <section className="welcome-closing"><span className="welcome-closing-icon"><Sparkles size={25} /></span><div><h2>Something only you could make.</h2><p>Your voice, your ideas. A little help bringing them to life.</p></div><button className="primary" onClick={() => onNavigate("create")}>Create your next piece <ArrowRight size={16} /></button></section>
  </div>;
}
