"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Bot,
  CalendarDays,
  Check,
  FileText,
  Film,
  Lightbulb,
  LogOut,
  Megaphone,
  Palette,
  Plus,
  Radar,
  RefreshCcw,
  Send,
  Settings,
  Sparkles,
  UserRound,
  Wand2
} from "lucide-react";
import type { Asset, BrandKit, Brief, Competitor, Opportunity, Platform, PublishItem, Workspace } from "@/lib/types";

type AppData = {
  user: { id: string; email: string; name: string; role: string };
  workspace: Workspace;
  brandKit: BrandKit;
  competitors: Competitor[];
  opportunities: Opportunity[];
  briefs: Brief[];
  assets: Asset[];
  publishQueue: PublishItem[];
  activity: { id: string; message: string; createdAt: string }[];
};

const platforms: Platform[] = ["TikTok", "Instagram", "LinkedIn", "Facebook"];
type IntegrationData = Record<string, { configured?: boolean; ok?: boolean; status?: number; error?: string; baseUrl?: string; actor?: string }>;

async function post(action: string, payload: Record<string, unknown> = {}) {
  const res = await fetch("/api/social", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload })
  });
  if (!res.ok) throw new Error((await res.json()).error || "Request failed");
  return res.json();
}

export default function Home() {
  const [data, setData] = useState<AppData | null>(null);
  const [screen, setScreen] = useState("home");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authError, setAuthError] = useState("");
  const [toast, setToast] = useState("");
  const [integrations, setIntegrations] = useState<IntegrationData | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const res = await fetch("/api/app", { cache: "no-store" });
    if (res.status === 401) {
      setData(null);
      setLoading(false);
      return;
    }
    setData(await res.json());
    setLoading(false);
    fetch("/api/integrations", { cache: "no-store" })
      .then((health) => (health.ok ? health.json() : null))
      .then(setIntegrations)
      .catch(() => setIntegrations(null));
  }

  useEffect(() => {
    refresh();
  }, []);

  async function run(action: string, payload: Record<string, unknown> = {}, message = "Updated") {
    try {
      await post(action, payload);
      await refresh();
      setToast(message);
    } catch (error) {
      await refresh();
      setToast(error instanceof Error ? error.message : "Action failed");
    }
    setTimeout(() => setToast(""), 2200);
  }

  async function submitAuth(form: FormData) {
    setAuthError("");
    const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
    const body = Object.fromEntries(form.entries());
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      setAuthError((await res.json()).error || "Authentication failed");
      return;
    }
    await refresh();
  }

  const metrics = useMemo(() => {
    if (!data) return null;
    return {
      high: data.opportunities.filter((item) => item.gapScore >= 80 && item.status !== "dismissed").length,
      briefs: data.briefs.filter((item) => item.status === "new" || item.status === "approved").length,
      assets: data.assets.filter((item) => item.status === "ready").length,
      scheduled: data.publishQueue.filter((item) => item.status === "scheduled").length
    };
  }, [data]);

  if (loading) return <div className="loading">Loading ContentAgent Social...</div>;

  if (!data) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <div>
            <div className="brand-mark">CA</div>
            <h1>ContentAgent Social</h1>
            <p>Intelligence-first content planning, production, and publishing for SME social channels.</p>
          </div>
          <form action={submitAuth} className="auth-card">
            <div className="segmented">
              <button type="button" className={authMode === "login" ? "on" : ""} onClick={() => setAuthMode("login")}>Sign in</button>
              <button type="button" className={authMode === "register" ? "on" : ""} onClick={() => setAuthMode("register")}>Create account</button>
            </div>
            {authMode === "register" && (
              <>
                <label>Name<input name="name" placeholder="Sean Tan" /></label>
                <label>Workspace<input name="workspaceName" placeholder="My Social Workspace" /></label>
                <label>Niche<input name="niche" placeholder="SME AI automation" /></label>
              </>
            )}
            <label>Email<input name="email" type="email" defaultValue={authMode === "login" ? "demo@contentagent.tech" : ""} required /></label>
            <label>Password<input name="password" type="password" defaultValue={authMode === "login" ? "demo1234" : ""} required /></label>
            {authError && <div className="error">{authError}</div>}
            <button className="primary" type="submit">{authMode === "login" ? "Enter workspace" : "Create workspace"}</button>
          </form>
        </section>
      </main>
    );
  }

  const nav = [
    ["home", "Today", Activity],
    ["intelligence", "Intelligence", Radar],
    ["briefs", "Briefs", FileText],
    ["production", "Production", Wand2],
    ["ugc", "UGC Video", Film],
    ["publish", "Publish", CalendarDays],
    ["analytics", "Analytics", BarChart3],
    ["brand", "Brand Kit", Palette],
    ["settings", "Settings", Settings]
  ] as const;

  return (
    <div className="app-shell">
      {toast && <div className="toast">{toast}</div>}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-name">ContentAgent Social</div>
          <div className="brand-sub">{data.workspace.plan} workspace</div>
        </div>
        <nav className="nav-list">
          {nav.map(([key, label, Icon]) => (
            <button key={key} className={`nav-item ${screen === key ? "active" : ""}`} onClick={() => setScreen(key)}>
              <span className="nav-icon"><Icon size={16} /></span>
              <span className="nav-label">{label}</span>
              {key === "intelligence" && metrics?.high ? <span className="nav-badge">{metrics.high}</span> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="ws-pill">
            <div className="ws-av">{data.user.name.slice(0, 2).toUpperCase()}</div>
            <div>
              <div className="ws-name">{data.user.name}</div>
              <div className="ws-role">{data.user.role}</div>
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-top">
            <div>
              <div className="topbar-title">{title(screen)}</div>
              <div className="topbar-breadcrumb">{data.workspace.niche}</div>
            </div>
            <div className="topbar-right">
              <span className="credit-pill"><b>{data.workspace.credits}</b> credits</span>
              <button className="icon-btn" title="Refresh" onClick={refresh}><RefreshCcw size={15} /></button>
              <button className="icon-btn" title="Log out" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); setData(null); }}><LogOut size={15} /></button>
            </div>
          </div>
          <div className="momentum-strip">
            <div className="mom-item"><Sparkles size={14} /><b>{metrics?.high}</b><span>high-priority gaps</span></div>
            <div className="mom-item"><FileText size={14} /><b>{metrics?.briefs}</b><span>active briefs</span></div>
            <div className="mom-item"><Wand2 size={14} /><b>{metrics?.assets}</b><span>ready assets</span></div>
            <div className="mom-item"><CalendarDays size={14} /><b>{metrics?.scheduled}</b><span>scheduled posts</span></div>
          </div>
        </header>

        <section className="panel active">
          {screen === "home" && <HomePanel data={data} setScreen={setScreen} run={run} />}
          {screen === "intelligence" && <IntelligencePanel data={data} run={run} />}
          {screen === "briefs" && <BriefPanel data={data} run={run} />}
          {screen === "production" && <ProductionPanel data={data} run={run} />}
          {screen === "ugc" && <UgcPanel run={run} />}
          {screen === "publish" && <PublishPanel data={data} run={run} />}
          {screen === "analytics" && <AnalyticsPanel data={data} />}
          {screen === "brand" && <BrandPanel data={data} run={run} />}
          {screen === "settings" && <SettingsPanel integrations={integrations} />}
        </section>
      </main>
    </div>
  );
}

function title(screen: string) {
  return ({ home: "Today's Brief", intelligence: "Social Intelligence", briefs: "Content Briefs", production: "Production Engine", ugc: "UGC Video Generator", publish: "Publishing Queue", analytics: "Performance Monitoring", brand: "Brand Kit", settings: "Deployment Settings" } as Record<string, string>)[screen];
}

function HomePanel({ data, setScreen, run }: { data: AppData; setScreen: (s: string) => void; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<void> }) {
  const lead = data.opportunities.filter((item) => item.status !== "dismissed").sort((a, b) => b.gapScore - a.gapScore)[0];
  return (
    <div className="home-panel">
      <h2>Good morning, {data.user.name.split(" ")[0]}</h2>
      <p className="muted">One strong opportunity is ready to turn into content today.</p>
      {lead && <article className="brief-card hero-card">
        <div className="tb-header">
          <div>
            <div className="tb-title">High-priority opportunity</div>
            <div className="tb-hook">{lead.topic}</div>
            <div className="tb-meta">{lead.platform} · {lead.format} · Gap score {lead.gapScore}</div>
          </div>
          <Lightbulb />
        </div>
        <div className="tb-body">
          <p>Trend velocity and competitor gap are both above threshold. Generate a brief while the topic is still early.</p>
          <div className="tb-tags"><span>{lead.platform}</span><span>{lead.format}</span><span>{lead.gapScore >= 80 ? "High priority" : "Recommended"}</span></div>
          <div className="row-actions">
            <button className="primary" onClick={() => run("generateOpportunity", { id: lead.id }, "Brief generated")}>Generate brief</button>
            <button onClick={() => setScreen("intelligence")}>View intelligence</button>
          </div>
        </div>
      </article>}
      <div className="grid three">
        <Metric label="Setup complete" value={`${data.workspace.setup}%`} />
        <Metric label="Competitors tracked" value={data.competitors.length} />
        <Metric label="Credits" value={data.workspace.credits} />
      </div>
      <PanelCard title="Recent activity">
        {data.activity.map((item) => <div className="activity-row" key={item.id}><Check size={14} />{item.message}</div>)}
      </PanelCard>
    </div>
  );
}

function IntelligencePanel({ data, run }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<void> }) {
  return (
    <div className="wide">
      <div className="split">
        <PanelCard title="Opportunity gaps">
          <div className="section-actions"><button className="primary" onClick={() => run("refreshTrends", {}, "Apify trends refreshed")}><Radar size={14} />Refresh via Apify</button></div>
          <div className="table">
            {data.opportunities.filter((item) => item.status !== "dismissed").map((opp) => (
              <div className="table-row" key={opp.id}>
                <div><b>{opp.topic}</b><span>{opp.platform} · {opp.format}</span></div>
                <Score value={opp.gapScore} />
                <button onClick={() => run("generateOpportunity", { id: opp.id }, "Brief generated")}>Brief</button>
                <button className="ghost" onClick={() => run("dismissOpportunity", { id: opp.id }, "Opportunity dismissed")}>Dismiss</button>
              </div>
            ))}
          </div>
        </PanelCard>
        <PanelCard title="Add competitor">
          <form action={(form) => run("addCompetitor", Object.fromEntries(form.entries()), "Competitor added")} className="stack-form">
            <label>Platform<select name="platform">{platforms.map((p) => <option key={p}>{p}</option>)}</select></label>
            <label>Handle<input name="handle" placeholder="@competitor" required /></label>
            <label>Cadence<select name="cadence"><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
            <button className="primary"><Plus size={14} />Add monitor</button>
          </form>
          <div className="mini-list">{data.competitors.map((item) => <span key={item.id}>{item.platform}: {item.handle}</span>)}</div>
        </PanelCard>
      </div>
    </div>
  );
}

function BriefPanel({ data, run }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<void> }) {
  const cols = ["new", "approved", "production", "scheduled", "published"];
  return <div className="kanban">{cols.map((col) => <div className="kanban-col" key={col}><h3>{col}</h3>{data.briefs.filter((b) => b.status === col).map((brief) => <article className="mini-card" key={brief.id}><b>{brief.topic}</b><p>{brief.hooks[0]}</p><div className="chips">{brief.platforms.map((p) => <span key={p}>{p}</span>)}</div><div className="row-actions">{brief.status === "new" && <button onClick={() => run("approveBrief", { id: brief.id }, "Brief approved")}>Approve</button>}{brief.status === "approved" && <button onClick={() => run("renderAsset", { id: brief.id }, "Asset rendered")}>Render</button>}</div></article>)}</div>)}</div>;
}

function ProductionPanel({ data, run }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<void> }) {
  return <div className="grid two">{data.assets.map((asset) => <PanelCard key={asset.id} title={asset.title}><div className={`asset-preview ${asset.type}`}>{asset.assetUrl ? <video src={asset.assetUrl} controls /> : <><Bot size={34} /><span>{asset.type.toUpperCase()}</span></>}</div><div className="progress"><span style={{ width: `${asset.progress}%` }} /></div><p className="muted">Status: {asset.status}{asset.provider ? ` · ${asset.provider}` : ""}{asset.providerTaskId ? ` · ${asset.providerTaskId}` : ""}</p>{asset.error && <p className="provider-error">{asset.error}</p>}{asset.assetUrl && <a className="asset-link" href={asset.assetUrl} target="_blank">Open generated asset</a>}<div className="row-actions">{asset.providerTaskId && asset.status !== "ready" && <button onClick={() => run("pollAsset", { id: asset.id }, "Kie status refreshed")}>Poll Kie</button>}<button onClick={() => run("scheduleAsset", { id: asset.id, platform: "LinkedIn" }, "Asset scheduled")}>Schedule LinkedIn</button><button onClick={() => run("scheduleAsset", { id: asset.id, platform: "TikTok" }, "Asset scheduled")}>Schedule TikTok</button></div></PanelCard>)}</div>;
}

function UgcPanel({ run }: { run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<void> }) {
  return <PanelCard title="Generate UGC video"><form className="ugc-form" action={(form) => run("generateUgc", Object.fromEntries(form.entries()), "UGC video generated")}><label>Product / subject<input name="product" placeholder="AI automation audit" required /></label><label>Key selling points<textarea name="sellingPoints" placeholder="Save time, reduce manual reporting, improve follow-up speed" /></label><label>Style<select name="style"><option>Talking Head</option><option>Product Showcase</option><option>Lifestyle Demo</option><option>Testimonial</option></select></label><label>Duration<select name="duration"><option value="30">30 seconds · 15 credits</option><option value="60">60 seconds · 25 credits</option></select></label><button className="primary"><Film size={15} />Generate UGC job</button></form></PanelCard>;
}

function PublishPanel({ data, run }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<void> }) {
  return <PanelCard title="Scheduled and published posts"><div className="table">{data.publishQueue.map((item) => <div className="table-row" key={item.id}><div><b>{item.title}</b><span>{item.platform} · {new Date(item.scheduledAt).toLocaleString()}{item.providerRequestId ? ` · ${item.providerRequestId}` : ""}</span>{item.error && <span className="provider-error inline">{item.error}</span>}</div><span className={`status ${item.status}`}>{item.status}</span>{item.status !== "published" && <button onClick={() => run("publishNow", { id: item.id }, "Upload-Post publish requested")}><Send size={14} />Publish now</button>}</div>)}</div></PanelCard>;
}

function AnalyticsPanel({ data }: { data: AppData }) {
  return <div className="grid three"><Metric label="Engagement forecast" value="4.8%" /><Metric label="Published posts" value={data.publishQueue.filter((p) => p.status === "published").length} /><Metric label="Avg gap score" value={Math.round(data.opportunities.reduce((sum, item) => sum + item.gapScore, 0) / Math.max(1, data.opportunities.length))} /><PanelCard title="Feedback loop"><p>Published assets retain their originating brief, template, platform, and score so future recommendations can learn from performance results.</p></PanelCard></div>;
}

function BrandPanel({ data, run }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<void> }) {
  return <PanelCard title="Brand kit"><form className="brand-form" action={(form) => run("updateBrandKit", { brandKit: Object.fromEntries(form.entries()) }, "Brand kit saved")}><label>Primary<input name="primary" type="color" defaultValue={data.brandKit.primary} /></label><label>Secondary<input name="secondary" type="color" defaultValue={data.brandKit.secondary} /></label><label>Accent<input name="accent" type="color" defaultValue={data.brandKit.accent} /></label><label>Voice<textarea name="voice" defaultValue={data.brandKit.voice} /></label><button className="primary">Save brand kit</button></form></PanelCard>;
}

function SettingsPanel({ integrations }: { integrations: IntegrationData | null }) {
  const [connectUrl, setConnectUrl] = useState("");
  const [connectError, setConnectError] = useState("");
  async function createConnectUrl() {
    setConnectError("");
    const res = await fetch("/api/integrations/upload-post/connect", { method: "POST" });
    const json = await res.json();
    if (!res.ok) {
      setConnectError(json.error || "Could not create Upload-Post link");
      return;
    }
    setConnectUrl(json.access_url || "");
  }
  return <div className="grid two"><PanelCard title="Provider status"><div className="provider-list">{Object.entries(integrations || {}).map(([name, value]) => <div className="provider-row" key={name}><b>{name}</b><span className={value.ok || value.configured ? "good" : "bad"}>{value.ok ? "verified" : value.configured ? "configured" : "missing"}</span>{value.status && <small>HTTP {value.status}</small>}{value.error && <small>{value.error}</small>}</div>)}</div></PanelCard><PanelCard title="Connect social accounts"><p className="muted">Generate an Upload-Post connection page for the local profile. Publishing will fail until the target social account is connected there.</p><button className="primary" onClick={createConnectUrl}><Megaphone size={14} />Create connect link</button>{connectUrl && <a className="asset-link" href={connectUrl} target="_blank">Open Upload-Post connection page</a>}{connectError && <p className="provider-error">{connectError}</p>}</PanelCard><PanelCard title="Token handling"><p>Keys are loaded from ignored local environment variables. Rotate the pasted keys before production because they were exposed in chat.</p><code>KIE_API_TOKEN, APIFY_API_TOKEN, UPLOAD_POST_API_KEY</code></PanelCard><PanelCard title="Recommended production shape"><p>GCP Cloud Run or a VPS can run this app later. Keep Postgres, queue, object storage, and provider keys outside the client.</p></PanelCard></div>;
}

function PanelCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="card"><h3>{title}</h3>{children}</section>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="metric"><strong>{value}</strong><span>{label}</span></div>;
}

function Score({ value }: { value: number }) {
  return <div className="score"><strong>{value}</strong><span style={{ width: `${value}%` }} /></div>;
}
