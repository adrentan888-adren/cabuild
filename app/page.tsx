"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  Search,
  Send,
  Settings,
  Sparkles,
  UserRound,
  Wand2
} from "lucide-react";
import type { Asset, BrandKit, Brief, Competitor, CompetitorResult, Opportunity, Platform, PublishItem, SocialAudit, Workspace } from "@/lib/types";

type AppData = {
  user: { id: string; email: string; name: string; role: string };
  workspace: Workspace;
  brandKit: BrandKit;
  competitors: Competitor[];
  competitorResults: CompetitorResult[];
  socialAudits: SocialAudit[];
  opportunities: Opportunity[];
  briefs: Brief[];
  assets: Asset[];
  publishQueue: PublishItem[];
  researchScans: {
    id: string;
    url: string;
    query?: string;
    dimensions?: {
      actorSources?: string[];
      contentTypes?: string[];
      formats?: string[];
      uploadDate?: string;
    };
    platform: Platform;
    minViews: number;
    resultIds: string[];
    createdAt: string;
    source: "apify" | "cache" | "fallback";
    error?: string;
  }[];
  activity: { id: string; message: string; createdAt: string }[];
};

const platforms: Platform[] = ["TikTok", "Instagram", "LinkedIn", "Facebook", "X"];
const suggestedResearchKeywords = [
  ["AI automation", 92],
  ["leadership mindset", 87],
  ["n8n workflows", 76],
  ["SME growth", 72],
  ["personal branding", 68]
] as const;
const researchActors = [
  { id: "instagram", label: "Instagram", dimensions: ["Reels (9:16)", "Image / carousel (1:1 or 4:5)"] },
  { id: "tiktok", label: "TikTok", dimensions: ["Short-form video (9:16)"] },
  { id: "youtube", label: "YouTube", dimensions: ["Long-form video (16:9)", "Shorts (9:16)"] },
  { id: "facebook", label: "Facebook", dimensions: ["Feed post (1:1 or 4:5)", "Reels (9:16)", "Video (16:9)"] },
  { id: "linkedin", label: "LinkedIn", dimensions: ["Text post (feed)", "Article (editorial)", "Image / carousel (1:1 or 4:5)"] }
] as const;
type IntegrationData = Record<string, { configured?: boolean; ok?: boolean; status?: number; error?: string; baseUrl?: string; actor?: string }>;
type PendingPlan = { title: string; description: string; startedAt: number };

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
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);
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
      const result = await post(action, payload);
      await refresh();
      setToast(message);
      return result;
    } catch (error) {
      await refresh();
      setToast(error instanceof Error ? error.message : "Action failed");
      return null;
    }
    finally {
      setTimeout(() => setToast(""), 2200);
    }
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
    ["home", "Home", Activity],
    ["audit", "Social Audit", BarChart3],
    ["persona", "Persona", UserRound],
    ["research", "Research", Radar],
    ["plan", "Content Plan", FileText],
    ["create", "Create Content", Wand2],
    ["publish", "Publish", CalendarDays],
    ["automation", "Automation", RefreshCcw],
    ["analyse", "Analyse", BarChart3]
  ] as const;

  return (
    <div className="app-shell">
      {toast && <div className="toast">{toast}</div>}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-name">ContentAgent</div>
          <div className="brand-sub">CEO Reputation Module</div>
        </div>
        <nav className="nav-list">
          {nav.map(([key, label, Icon]) => (
            <button key={key} className={`nav-item ${screen === key ? "active" : ""}`} onClick={() => setScreen(key)}>
              <span className="nav-icon"><Icon size={16} /></span>
              <span className="nav-label">{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="ws-pill">
            <div className="ws-av">ST</div>
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
              <button className="icon-btn" title="Settings" onClick={() => setScreen("settings")}><Settings size={15} /></button>
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
          {screen === "audit" && <SocialAuditPanel data={data} run={run} />}
          {screen === "persona" && <PersonaPanel data={data} run={run} />}
          {screen === "research" && <IntelligencePanel data={data} run={run} setScreen={setScreen} setPendingPlan={setPendingPlan} />}
          {screen === "plan" && <BriefPanel data={data} run={run} setScreen={setScreen} pendingPlan={pendingPlan} />}
          {screen === "create" && <CreateContentPanel data={data} run={run} />}
          {screen === "publish" && <PublishPanel data={data} run={run} />}
          {screen === "automation" && <AutomationPanel data={data} run={run} />}
          {screen === "analyse" && <AnalyticsPanel data={data} />}
          {screen === "settings" && <SettingsPanel integrations={integrations} />}
        </section>
      </main>
    </div>
  );
}

function title(screen: string) {
  return ({ home: "Home", audit: "Social Audit", persona: "Persona", research: "Research", plan: "Content Plan", create: "Create Content", publish: "Publish", automation: "Automation", analyse: "Analyse", settings: "Settings" } as Record<string, string>)[screen];
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
            <div className="tb-meta">{lead.platform} ﾂｷ {lead.format} ﾂｷ Gap score {lead.gapScore}</div>
          </div>
          <Lightbulb />
        </div>
        <div className="tb-body">
          <p>Trend velocity and competitor gap are both above threshold. Generate a brief while the topic is still early.</p>
          <div className="tb-tags"><span>{lead.platform}</span><span>{lead.format}</span><span>{lead.gapScore >= 80 ? "High priority" : "Recommended"}</span></div>
          <div className="row-actions">
            <button className="primary" onClick={() => run("generateOpportunity", { id: lead.id }, "Brief generated")}>Generate brief</button>
            <button onClick={() => setScreen("research")}>View research</button>
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

function SocialAuditPanel({ data, run }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<void> }) {
  const [auditing, setAuditing] = useState(false);
  const latestAudit = data.socialAudits?.[0];
  const auditResults = latestAudit
    ? latestAudit.topResultIds
        .map((resultId) => data.competitorResults.find((item) => item.id === resultId))
        .filter((item): item is CompetitorResult => Boolean(item))
    : [];

  async function submitAudit(form: FormData) {
    setAuditing(true);
    await run("runSocialAudit", Object.fromEntries(form.entries()), "Social audit completed");
    setAuditing(false);
  }

  return (
    <div className="mock-wrap">
      <div className="card">
        <div className="audit-hero">
          <div className="score-ring"><div><strong>{latestAudit?.authorityScore || 0}</strong><span>Authority</span></div></div>
          <div>
            <div className="clbl">Social Audit</div>
            <h2>{latestAudit ? `${latestAudit.handle} social authority snapshot` : "Add your social profile to start the audit"}</h2>
            <p className="muted">{latestAudit ? "Platform health, content traction, and top-performing posts used by Research and Content Plan." : "Paste your TikTok, Instagram, Facebook, LinkedIn, X, or other social URL to run the first audit."}</p>
          </div>
          <span className="last-upd">{latestAudit ? `Updated ${new Date(latestAudit.createdAt).toLocaleString()}` : "No audit yet"}</span>
        </div>
      </div>
      <PanelCard title={latestAudit ? "Audit another profile" : "Your social profile URL"}>
        <form className="audit-url-form" action={submitAudit}>
          <label>Social URL<input name="url" type="url" placeholder="https://www.instagram.com/yourbrand or https://www.tiktok.com/@yourbrand" defaultValue={latestAudit?.url || ""} required /></label>
          <button className="primary" disabled={auditing}><Radar size={14} />{auditing ? "Auditing..." : latestAudit ? "Run new audit" : "Run social audit"}</button>
        </form>
        {!latestAudit && <p className="muted">No stored profile URL found for this workspace. Add one here and the latest audit will be saved for future visits.</p>}
        {latestAudit?.error && <p className="provider-error">Fallback used: {latestAudit.error}</p>}
      </PanelCard>
      <div className="grid three">
        <Metric label="Platforms audited" value={latestAudit ? 1 : 0} />
        <Metric label="Competitors tracked" value={data.competitors.length} />
        <Metric label="Posts analysed" value={latestAudit?.postsAnalysed || 0} />
      </div>
      <div className="split">
        <PanelCard title="Platform breakdown">
          {latestAudit ? (
            <>
              <div className="pb-row">
                <button className="linkish" onClick={() => run("runSocialAudit", { url: latestAudit.url }, "Social audit refreshed")}>{latestAudit.platform}</button>
                <div className="pb-tr"><span style={{ width: `${latestAudit.authorityScore}%` }} /></div>
                <span>{latestAudit.authorityScore}</span>
              </div>
              <div className="diag">Average views: {compact(latestAudit.avgViews)}  |  Average likes: {compact(latestAudit.avgLikes)}</div>
            </>
          ) : <div className="diag">Run your first audit to see platform health and engagement strength.</div>}
        </PanelCard>
        <PanelCard title="Recommended next actions">
          <div className="diag">{latestAudit ? "Use the strongest audited posts as references in Research, then create a content plan from the best-performing angle." : "Add your social URL first, then complete persona and run Research to compare against competitors."}</div>
          <div className="row-actions"><button className="primary" disabled={!latestAudit || auditing} onClick={async () => { if (!latestAudit) return; setAuditing(true); await run("runSocialAudit", { url: latestAudit.url }, "Social audit refreshed"); setAuditing(false); }}>{auditing ? "Auditing..." : "Refresh audit"}</button></div>
        </PanelCard>
      </div>
      {auditResults.length > 0 && (
        <PanelCard title="Top audited content">
          <div className="result-list">
            {auditResults.map((item) => (
              <div className="result-row" key={item.id}>
                <div className="thumb">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" /> : <BarChart3 size={18} />}</div>
                <div>
                  <a href={item.url} target="_blank">{item.title}</a>
                  <span>{new Date(item.publishedAt).toLocaleString()}</span>
                </div>
                <div className="result-stat"><strong>{compact(item.views)}</strong><span>views</span></div>
                <div className="result-stat"><strong>{compact(item.likes)}</strong><span>likes</span></div>
              </div>
            ))}
          </div>
        </PanelCard>
      )}
    </div>
  );
}

function PersonaPanel({ data, run }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<void> }) {
  return (
    <div className="mock-wrap">
      <div className="mhdr">
        <div className="msub">Persona</div>
        <h2>Founder-led voice profile</h2>
      </div>
      <div className="grid two">
        <PanelCard title="Build path">
          <div className="path-grid">
            <div className="path-card featured"><UserRound /><b>Reference persona</b><span>Model voice from top posts and creator examples</span></div>
            <div className="path-card"><FileText /><b>Manual profile</b><span>Set tone, topics, words to use, and words to avoid</span></div>
          </div>
        </PanelCard>
        <PanelCard title="Voice guidelines">
          <form className="brand-form" action={(form) => run("updateBrandKit", { brandKit: Object.fromEntries(form.entries()) }, "Persona saved")}>
            <label>Voice<textarea name="voice" defaultValue={data.brandKit.voice} /></label>
            <button className="primary">Save persona</button>
          </form>
        </PanelCard>
      </div>
      <PanelCard title="Tone profile">
        <div className="tone-grid">
          <Metric label="Direct" value="82%" />
          <Metric label="Practical" value="91%" />
          <Metric label="Contrarian" value="64%" />
        </div>
      </PanelCard>
    </div>
  );
}

function IntelligencePanel({ data, run, setScreen, setPendingPlan }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<any>; setScreen: (screen: string) => void; setPendingPlan: (plan: PendingPlan | null) => void }) {
  const [searchMode, setSearchMode] = useState<"url" | "keywords">("url");
  const [sortBy, setSortBy] = useState<"views" | "likes" | "date">("views");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [sortOpen, setSortOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeScanId, setActiveScanId] = useState<string | null>(data.researchScans[0]?.id || null);
  const [keywordText, setKeywordText] = useState("AI automation, n8n workflows");
  const [actorSource, setActorSource] = useState("instagram");
  const [uploadDate, setUploadDate] = useState("");
  const [scanStatus, setScanStatus] = useState<"url" | "keywords" | null>(null);
  const [pendingScan, setPendingScan] = useState<"url" | "keywords" | null>(null);
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
  const [scanElapsed, setScanElapsed] = useState(0);
  const activeScanStatus = scanStatus || pendingScan;
  const activeScan = data.researchScans.find((scan) => scan.id === activeScanId) || data.researchScans[0];
  const visibleResults = activeScan
    ? data.competitorResults.filter((item) => activeScan.resultIds.includes(item.id))
    : data.competitorResults;
  const activeScanResultCount = activeScan ? visibleResults.length : 0;
  const sortedResults = [...visibleResults].sort((a, b) => {
    const direction = sortDir === "desc" ? 1 : -1;
    if (sortBy === "likes") return (b.likes - a.likes) * direction;
    if (sortBy === "date") return (new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()) * direction;
    return (b.views - a.views) * direction;
  });
  const totalViews = sortedResults.reduce((sum, item) => sum + item.views, 0);
  const topResult = sortedResults[0];
  useEffect(() => {
    if (!activeScanStatus || !scanStartedAt) {
      setScanElapsed(0);
      return;
    }
    const tick = () => setScanElapsed(Math.max(1, Math.floor((Date.now() - scanStartedAt) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [activeScanStatus, scanStartedAt]);
  const chooseSort = (next: "views" | "likes" | "date") => {
    if (next === sortBy) setSortDir((dir) => (dir === "desc" ? "asc" : "desc"));
    else {
      setSortBy(next);
      setSortDir("desc");
    }
    setSortOpen(false);
  };
  const scanUrl = async (form: FormData) => {
    setPendingScan("url");
    setScanStatus("url");
    setScanStartedAt(Date.now());
    try {
      const result = await run("scanResearchUrl", Object.fromEntries(form.entries()), "Research scan complete");
      if (result?.id) setActiveScanId(result.id);
    } finally {
      setScanStatus(null);
      setPendingScan(null);
      setScanStartedAt(null);
    }
  };
  const scanKeywords = async (form: FormData) => {
    setPendingScan("keywords");
    setScanStatus("keywords");
    setScanStartedAt(Date.now());
    try {
      const result = await run("scanKeywordResearch", {
        keywords: keywordText,
        minViews: Number(form.get("minViews") || 0),
        dimensions: { actorSources: [actorSource], uploadDate }
      }, "Keyword research complete");
      if (result?.id) setActiveScanId(result.id);
    } finally {
      setScanStatus(null);
      setPendingScan(null);
      setScanStartedAt(null);
    }
  };
  const createPlan = async (item: CompetitorResult) => {
    setPendingPlan({ title: item.title, description: item.description || `Analyzing ${item.platform} result with ${compact(item.views)} views.`, startedAt: Date.now() });
    setScreen("plan");
    try {
      await run("createPlanFromResearch", { id: item.id }, "Content plan generated from research");
    } finally {
      setPendingPlan(null);
    }
  };
  const addKeyword = (keyword: string) => {
    const parts = keywordText.split(",").map((item) => item.trim()).filter(Boolean);
    if (!parts.some((item) => item.toLowerCase() === keyword.toLowerCase())) setKeywordText([...parts, keyword].join(", "));
  };
  const scanLabel = (scanItem: AppData["researchScans"][number]) => scanItem.query || (scanItem.url.startsWith("keyword:") ? scanItem.url.split("|")[0].replace("keyword:", "") : scanItem.url);
  return (
    <div className="research-page">
      <section className="research-hero">
        <div>
          <div className="clbl">Research</div>
          <h2>Find competitor posts worth turning into content plans</h2>
          <p>Scan a social URL or search by keywords through selected sources, then sort qualified posts by views, likes, or date.</p>
        </div>
        <div className="history-wrap">
          <button onClick={() => setHistoryOpen((open) => !open)}>History</button>
          {historyOpen && (
            <div className="history-menu">
              {data.researchScans.slice(0, 10).map((scanItem) => (
                <button key={scanItem.id} onClick={() => { setActiveScanId(scanItem.id); setHistoryOpen(false); }}>
                  <b>{scanItem.query ? "Keyword search" : scanItem.platform}</b>
                  <span>{scanLabel(scanItem)}</span>
                  <small>{new Date(scanItem.createdAt).toLocaleString()} ﾂｷ min {compact(scanItem.minViews)}</small>
                </button>
              ))}
              {data.researchScans.length === 0 && <div className="history-empty">No previous scans</div>}
            </div>
          )}
        </div>
      </section>

      <div className="research-kpis">
        <Metric label="Tracked sources" value={data.competitors.length} />
        <Metric label="Qualified results" value={sortedResults.length} />
        <Metric label="Total views" value={compact(totalViews)} />
        <Metric label="Top post" value={topResult ? compact(topResult.views) : "-"} />
      </div>

      <section className={`research-card ${activeScanStatus ? "loading" : ""}`}>
        <div className="research-mode">
          <button className={searchMode === "url" ? "on" : ""} onClick={() => setSearchMode("url")}><Radar size={14} />Search by URL</button>
          <button className={searchMode === "keywords" ? "on" : ""} onClick={() => setSearchMode("keywords")}><Search size={14} />Search by keywords</button>
        </div>
        {searchMode === "url" ? (
          <form onSubmit={(event) => { event.preventDefault(); if (!activeScanStatus) void scanUrl(new FormData(event.currentTarget)); }} className="research-form">
            <label>Social URL<input name="url" type="url" placeholder="https://www.tiktok.com/@brand/video/123 or Instagram/Reels/Facebook/X URL" required /></label>
            <label>Minimum views<input name="minViews" type="number" min="0" step="1000" defaultValue="10000" /></label>
            <button className="primary" disabled={activeScanStatus !== null} aria-busy={activeScanStatus === "url"}><Radar size={14} />{activeScanStatus === "url" ? "Scanning..." : "Scan"}</button>
          </form>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); if (!activeScanStatus) void scanKeywords(new FormData(event.currentTarget)); }} className="keyword-form">
            <div className="keyword-input-row">
              <label>Keywords<input value={keywordText} onChange={(event) => setKeywordText(event.target.value)} placeholder="AI automation, founder productivity, n8n workflows" required /></label>
              <label>Minimum views<input name="minViews" type="number" min="0" step="1000" defaultValue="10000" /></label>
              <button className="primary" disabled={activeScanStatus !== null} aria-busy={activeScanStatus === "keywords"}><Search size={14} />{activeScanStatus === "keywords" ? "Scanning..." : "Search"}</button>
            </div>
            <div className="suggested-keywords">
              {suggestedResearchKeywords.map(([keyword, score]) => (
                <button type="button" key={keyword} onClick={() => addKeyword(keyword)}>
                  {keyword}<span>{score}</span>
                </button>
              ))}
            </div>
            <div className="dimension-shell">
              <label className="upload-date-filter">Upload Date<select value={uploadDate} onChange={(event) => setUploadDate(event.target.value)}>
                <option value="">Any time</option>
                <option value="today">Today</option>
                <option value="this-week">This Week</option>
                <option value="this-month">This Month</option>
                <option value="this-year">This Year</option>
              </select></label>
              <ActorSourceSelector selected={actorSource} onSelect={setActorSource} />
            </div>
          </form>
        )}
        {activeScanStatus && <div className="scan-progress"><span />{activeScanStatus === "keywords" ? "Searching Apify for matching content" : "Scanning URL with Apify"}<b>{scanElapsed}s</b></div>}
        {!activeScanStatus && activeScan && (
          <div className={`scan-outcome ${activeScan.source}`}>
            {activeScan.source === "apify" ? "Apify search completed" : "Fallback results shown"}
            <b>{activeScanResultCount}</b>
            <span>qualified results</span>
          </div>
        )}
        {activeScan?.error && <p className="provider-error">Apify fallback used: {activeScan.error}</p>}
      </section>

      <section className={`research-card results-card ${activeScanStatus ? "loading" : ""}`} aria-busy={activeScanStatus ? "true" : "false"}>
        <div className="research-head">
          <div>
            <h3>Qualified competitor results</h3>
            <p>Only posts above the selected minimum views are shown.</p>
          </div>
          <div className="sort-dropdown">
            <button onClick={() => setSortOpen((open) => !open)}>Sort: {sortBy === "date" ? "Date" : sortBy[0].toUpperCase() + sortBy.slice(1)} {sortDir}</button>
            {sortOpen && (
              <div className="sort-menu">
                <button onClick={() => chooseSort("views")}>Views {sortBy === "views" ? sortDir : ""}</button>
                <button onClick={() => chooseSort("likes")}>Likes {sortBy === "likes" ? sortDir : ""}</button>
                <button onClick={() => chooseSort("date")}>Date {sortBy === "date" ? sortDir : ""}</button>
              </div>
            )}
          </div>
        </div>
        <div className="result-list">
          {activeScanStatus && (
            <div className="result-loading">
              <b>{activeScanStatus === "keywords" ? "Searching content sources" : "Scanning source URL"}</b>
              <p>Apify is collecting and filtering results. This can take 10-30 seconds depending on the source.</p>
              <div><span /></div>
            </div>
          )}
          <div className={activeScanStatus ? "stale-results" : "fresh-results"}>
          {sortedResults.map((item) => (
            <article className="result-row" key={item.id}>
              <div className="result-thumb">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" /> : <span>{item.platform.slice(0, 2).toUpperCase()}</span>}</div>
              <div className="result-main">
                <a href={item.url} target="_blank">{item.title}</a>
                <span>{new Date(item.publishedAt).toLocaleString()} ﾂｷ captured {new Date(item.capturedAt).toLocaleDateString()}</span>
                {item.description && <small>{item.description}</small>}
              </div>
              <div className="result-stat"><b>{compact(item.views)}</b><span>views</span></div>
              <div className="result-stat"><b>{compact(item.likes)}</b><span>likes</span></div>
              <button className="plan-action" onClick={() => createPlan(item)}><FileText size={14} />Create plan</button>
            </article>
          ))}
          </div>
          {sortedResults.length === 0 && <div className="empty-state">{activeScan ? "Search completed, but no content matched the selected minimum views and filters. Lower the minimum views or broaden the content types." : "No qualified results yet. Search by URL or keywords to begin."}</div>}
        </div>
      </section>

    </div>
  );
}

function ActorSourceSelector({ selected, onSelect }: { selected: string; onSelect: (item: string) => void }) {
  return (
    <div className="content-type-group">
      <b>Source</b>
      <div>
        {researchActors.map((item) => (
          <button type="button" key={item.id} className={selected === item.id ? "on" : ""} onClick={() => onSelect(item.id)}>
            <span><input type="radio" checked={selected === item.id} readOnly tabIndex={-1} />{item.label}</span>
            <small>{item.dimensions.join(", ")}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function planContentKind(format: string): "video" | "image" | "text" {
  const lower = format.toLowerCase();
  if (lower.includes("video") || lower.includes("short") || lower.includes("reel") || lower.includes("tiktok") || lower.includes("youtube")) return "video";
  if (lower.includes("image") || lower.includes("carousel")) return "image";
  return "text";
}

function defaultPlanDuration(format: string) {
  const lower = format.toLowerCase();
  if (lower.includes("long")) return 60;
  return lower.includes("video") || lower.includes("short") || lower.includes("reel") ? 8 : "";
}

const contentFormatOptions = [
  "Short video 9:16",
  "Long-form video 16:9",
  "Image / carousel 1:1",
  "Image / carousel 4:5",
  "Text post",
  "Long-form article"
];

const generationModels = {
  video: [
    ["veo-fast", "Veo Fast", "$0.05-0.12/sec est."],
    ["seedance-2.0", "Seedance 2.0", "$0.04-0.10/sec est."]
  ],
  image: [
    ["nanobanana-pro", "Nanobanana Pro", "$0.03-0.08/image est."],
    ["gpt-image-2", "GPT-image 2", "$0.04-0.12/image est."]
  ],
  text: [
    ["gemini-3.5-flash", "Gemini 3.5 Flash", "<$0.01/post est."],
    ["claude-opus-4.8", "Claude Opus 4.8", "$0.02-0.10/post est."]
  ]
} as const;

function durationOptionsForModel(model: string) {
  if (model === "veo-fast") return [8];
  if (model === "seedance-2.0") return Array.from({ length: 12 }, (_, index) => index + 4);
  return [];
}

function closestDuration(value: number | string | undefined, options: number[]) {
  if (options.length === 0) return "";
  const numeric = Number(value || options[0]);
  return String(options.reduce((best, option) => Math.abs(option - numeric) < Math.abs(best - numeric) ? option : best, options[0]));
}

function defaultGenerationPrompt(brief: Brief, kind = planContentKind(brief.format)) {
  const existing = brief.videoPrompt || [brief.description, brief.outline?.join(". "), brief.creativeNotes].filter(Boolean).join("\n");
  if (existing.trim()) return existing;
  if (kind === "image") {
    return `Create a polished social carousel or image post about "${brief.topic}". Use clean SME business visuals, strong headline hierarchy, practical examples, brand-safe composition, and a clear final takeaway.`;
  }
  if (kind === "text") {
    return `Write a founder-led social post about "${brief.topic}". Make it practical, specific, concise, and useful for SME owners. Start with a strong hook, explain the insight, give an example, and close with a clear takeaway.`;
  }
  return `Create a ${brief.format || "short-form video"} about "${brief.topic}". Use a direct opening hook, practical SME automation example, clean office or screen-recording visuals, concise text overlays, natural pacing, and a clear CTA.`;
}

function defaultCaption(brief: Brief) {
  if (brief.caption?.trim()) return brief.caption;
  return `${brief.topic}. A practical reminder for SME teams: automate the repeatable work first, then scale the parts that need human judgment.`;
}

function defaultHashtags(brief: Brief) {
  if (brief.hashtags?.length) return brief.hashtags.join(", ");
  const formatTag = planContentKind(brief.format) === "video" ? "#VideoContent" : planContentKind(brief.format) === "image" ? "#Carousel" : "#ContentStrategy";
  return ["#SME", "#Automation", "#AI", formatTag].join(", ");
}

function PlanEditorForm({ brief, onSubmit, onCancel, submitLabel }: { brief?: Brief; onSubmit: (form: FormData) => Promise<void>; onCancel: () => void; submitLabel: string }) {
  const [format, setFormat] = useState(brief?.format && contentFormatOptions.includes(brief.format) ? brief.format : "Short video 9:16");
  return (
    <form action={onSubmit} className="plan-edit">
      {brief && <input type="hidden" name="id" value={brief.id} />}
      <label>Topic<input name="topic" defaultValue={brief?.topic || ""} required /></label>
      <label>Format<select name="format" value={format} onChange={(event) => setFormat(event.target.value)}>{contentFormatOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
      <label>Description<textarea name="description" defaultValue={brief?.description || ""} /></label>
      <label>Video prompt<textarea name="videoPrompt" defaultValue={brief?.videoPrompt || ""} /></label>
      {planContentKind(format) === "video" && <label>Duration (seconds)<input name="duration" type="number" min="1" step="1" defaultValue={brief?.duration || defaultPlanDuration(format)} /></label>}
      <label>Hooks<textarea name="hooks" defaultValue={(brief?.hooks || []).join("\n")} /></label>
      <label>Outline<textarea name="outline" defaultValue={(brief?.outline || []).join("\n")} /></label>
      <label>Shot list<textarea name="shotList" defaultValue={(brief?.shotList || []).join("\n")} /></label>
      <label>Creative notes<textarea name="creativeNotes" defaultValue={brief?.creativeNotes || ""} /></label>
      <label>Caption<textarea name="caption" defaultValue={brief?.caption || ""} /></label>
      <label>Hashtags<input name="hashtags" defaultValue={(brief?.hashtags || []).join(", ")} /></label>
      <div className="grid two">
        <label>Optimal time<input name="optimalTime" defaultValue={brief?.optimalTime || ""} /></label>
        <label>Expected performance<input name="expectedPerformance" defaultValue={brief?.expectedPerformance || ""} /></label>
      </div>
      <div className="row-actions">
        <button className="primary" type="submit"><Check size={14} />{submitLabel}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function BriefPanel({ data, run, setScreen, pendingPlan }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<any>; setScreen: (screen: string) => void; pendingPlan: PendingPlan | null }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [generatingBrief, setGeneratingBrief] = useState<Brief | null>(null);
  const [creatingPlan, setCreatingPlan] = useState(false);
  const planTime = (value?: string) => {
    const time = value ? new Date(value).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  };
  const plans = [...data.briefs].sort((a, b) => planTime(b.createdAt) - planTime(a.createdAt));
  const save = async (form: FormData) => {
    await run("updateBrief", Object.fromEntries(form.entries()), "Content plan updated");
    setEditingId(null);
  };
  const create = async (form: FormData) => {
    await run("createBrief", Object.fromEntries(form.entries()), "Content plan created");
    setCreatingPlan(false);
  };
  const generate = (brief: Brief) => setGeneratingBrief(brief);
  return (
    <div className="plan-page">
      {creatingPlan && (
        <div className="modal-backdrop">
          <div className="generation-modal">
            <div className="modal-head">
              <div>
                <h3>New content plan</h3>
                <p>Create a plan manually using the same editable fields as generated plans.</p>
              </div>
              <button onClick={() => setCreatingPlan(false)}>Close</button>
            </div>
            <PlanEditorForm onSubmit={create} onCancel={() => setCreatingPlan(false)} submitLabel="Create plan" />
          </div>
        </div>
      )}
      {generatingBrief && (
        <GenerationModal
          brief={generatingBrief}
          onClose={() => setGeneratingBrief(null)}
          onSubmit={async (payload) => {
            await run("generateDraftFromPlan", payload, "Generation queued in Publish");
            setGeneratingBrief(null);
            setScreen("publish");
          }}
        />
      )}
      <section className="plan-hero">
        <div>
          <div className="clbl">Content Plan</div>
          <h2>Review and refine generated plans</h2>
          <p>Each plan includes Gemini analysis, video prompt, caption, hashtags, and production notes before generating a draft.</p>
        </div>
        <div className="plan-hero-actions">
          <Metric label="Plans" value={plans.length} />
          <button className="primary" onClick={() => setCreatingPlan(true)}><Plus size={14} />New</button>
        </div>
      </section>
      <div className="plan-list">
        {pendingPlan && (
          <article className="plan-card pending-plan">
            <div className="plan-index"><span /></div>
            <div className="plan-summary">
              <h3>Generating content plan...</h3>
              <p>{pendingPlan.title}</p>
              <small>{pendingPlan.description}</small>
              <div className="mini-progress"><span /></div>
            </div>
            <span className="status generating">Generating</span>
          </article>
        )}
        {plans.map((brief, index) => (
          <article className="plan-card" key={brief.id}>
            {editingId === brief.id ? (
              <PlanEditorForm brief={brief} onSubmit={save} onCancel={() => setEditingId(null)} submitLabel="Save" />
            ) : (
              <>
                <div className="plan-card-head compact">
                  <div className="plan-number">{index + 1}</div>
                  <div>
                    <h3>{brief.topic}</h3>
                    <p>{brief.description || brief.hooks[0]}</p>
                  </div>
                  <div className="plan-type">{brief.format}</div>
                  <div className="plan-date">{brief.createdAt ? new Date(brief.createdAt).toLocaleString() : "No timestamp"}</div>
                  <div className="row-actions">
                    <button onClick={() => setEditingId(brief.id)}>Edit</button>
                    <button onClick={() => run("deleteBrief", { id: brief.id }, "Content plan deleted")}>Delete</button>
                    <button className="primary" onClick={() => generate(brief)}><Wand2 size={14} />Generate</button>
                  </div>
                </div>
              </>
            )}
          </article>
        ))}
        {plans.length === 0 && <div className="empty-state">No content plans yet. Create one from Research results.</div>}
      </div>
    </div>
  );
}

function GenerationModal({ brief, onClose, onSubmit }: { brief: Brief; onClose: () => void; onSubmit: (payload: Record<string, unknown>) => Promise<void> }) {
  const initialKind = planContentKind(brief.format);
  const [kind, setKind] = useState<"video" | "image" | "text">(initialKind);
  const [model, setModel] = useState<string>(generationModels[initialKind][0][0]);
  const [duration, setDuration] = useState(closestDuration(brief.duration || defaultPlanDuration(brief.format) || 8, durationOptionsForModel(generationModels[initialKind][0][0])));
  const [busy, setBusy] = useState(false);
  const durationOptions = durationOptionsForModel(model);
  const submit = async (form: FormData) => {
    setBusy(true);
    try {
      await onSubmit({
        ...Object.fromEntries(form.entries()),
        id: brief.id,
        generationType: kind,
        generationModel: model,
        duration: kind === "video" ? duration : undefined
      });
    } finally {
      setBusy(false);
    }
  };
  const changeKind = (next: "video" | "image" | "text") => {
    const nextModel = generationModels[next][0][0];
    setKind(next);
    setModel(nextModel);
    setDuration(closestDuration(brief.duration || defaultPlanDuration(brief.format) || 8, durationOptionsForModel(nextModel)));
  };
  const changeModel = (next: string) => {
    setModel(next);
    setDuration(closestDuration(duration || brief.duration || defaultPlanDuration(brief.format) || 8, durationOptionsForModel(next)));
  };
  const defaultPrompt = defaultGenerationPrompt(brief, kind);
  return (
    <div className="modal-backdrop">
      <section className="generation-modal">
        <div className="modal-head">
          <div>
            <div className="clbl">Generate Draft</div>
            <h3>{brief.topic}</h3>
            <p>{brief.format}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>x</button>
        </div>
        <form action={submit} className="generation-form">
          <input type="hidden" name="platform" value={brief.platforms[0] || "TikTok"} />
          <div className="model-options">
            {generationModels[kind].map(([value, label, price]) => (
              <button type="button" key={value} className={model === value ? "on" : ""} onClick={() => changeModel(value)}>
                <b>{label}</b>
                <span>{price}</span>
              </button>
            ))}
          </div>
          <div className="modal-grid">
            <label>Content type<select value={kind} onChange={(event) => changeKind(event.target.value as "video" | "image" | "text")}>
              <option value="video">Video</option>
              <option value="image">Image / carousel</option>
              <option value="text">Text post</option>
            </select></label>
            {kind === "video" && (
              <>
                <label>Duration (seconds)<select name="duration" value={duration} onChange={(event) => setDuration(event.target.value)}>{durationOptions.map((option) => <option key={option} value={option}>{option} seconds</option>)}</select></label>
                <label>Aspect ratio<select name="aspectRatio" defaultValue={brief.format.includes("16:9") ? "16:9" : "9:16"}><option value="9:16">9:16 vertical</option><option value="16:9">16:9 landscape</option><option value="1:1">1:1 square</option></select></label>
              </>
            )}
            {kind === "image" && (
              <>
                <label>Image size<select name="imageSize" defaultValue="1080x1350"><option>1080x1350</option><option>1080x1080</option><option>1920x1080</option></select></label>
                <label>Variants<input name="variants" type="number" min="1" max="4" defaultValue="1" /></label>
              </>
            )}
            {kind === "text" && (
              <>
                <label>Tone<select name="tone" defaultValue="Practical founder-led"><option>Practical founder-led</option><option>Educational</option><option>Contrarian</option><option>Executive concise</option></select></label>
                <label>Length<select name="length" defaultValue="Medium"><option>Short</option><option>Medium</option><option>Long</option></select></label>
              </>
            )}
          </div>
          <label>Generation prompt<textarea name="prompt" defaultValue={defaultPrompt} /></label>
          <label>Caption<textarea name="caption" defaultValue={defaultCaption(brief)} /></label>
          <label>Hashtags<input name="hashtags" defaultValue={defaultHashtags(brief)} /></label>
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button className="primary" disabled={busy}><Wand2 size={14} />{busy ? "Generating..." : "Generate"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function CreateContentPanel({ data, run }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<void> }) {
  return (
    <div className="mock-wrap">
      <div className="split">
        <PanelCard title="Create content">
          <DirectGenerationPanel run={run} />
        </PanelCard>
        <PanelCard title="Generated assets">
          <ProductionPanel data={data} run={run} />
        </PanelCard>
      </div>
    </div>
  );
}

function ProductionPanel({ data, run }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<void> }) {
  return <div className="asset-list">{data.assets.map((asset) => <section className="asset-card" key={asset.id}><div className={`asset-preview ${asset.type}`}>{asset.assetUrl ? <video src={asset.assetUrl} controls /> : <><Bot size={34} /><span>{asset.type.toUpperCase()}</span></>}</div><div><b>{asset.title}</b><p className="muted">Status: {asset.status}{asset.provider ? ` ﾂｷ ${asset.provider}` : ""}{asset.providerTaskId ? ` ﾂｷ ${asset.providerTaskId}` : ""}</p><div className="progress"><span style={{ width: `${asset.progress}%` }} /></div>{asset.error && <p className="provider-error">{asset.error}</p>}{asset.assetUrl && <a className="asset-link" href={asset.assetUrl} target="_blank">Open generated asset</a>}<div className="row-actions">{asset.providerTaskId && asset.status !== "ready" && <button onClick={() => run("pollAsset", { id: asset.id }, "Kie status refreshed")}>Poll Kie</button>}<button onClick={() => run("scheduleAsset", { id: asset.id, platform: "TikTok" }, "Scheduled for Mariana accounts")}>Schedule Mariana all accounts</button><button onClick={() => run("scheduleAsset", { id: asset.id, platform: "Facebook" }, "Asset scheduled")}>Schedule Facebook</button><button onClick={() => run("scheduleAsset", { id: asset.id, platform: "X" }, "Asset scheduled")}>Schedule X</button></div></div></section>)}</div>;
}

function DirectGenerationPanel({ run }: { run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<void> }) {
  const [kind, setKind] = useState<"video" | "image" | "text">("video");
  const [model, setModel] = useState<string>(generationModels.video[0][0]);
  const [duration, setDuration] = useState(closestDuration(8, durationOptionsForModel(generationModels.video[0][0])));
  const [busy, setBusy] = useState(false);
  const durationOptions = durationOptionsForModel(model);
  const changeKind = (next: "video" | "image" | "text") => {
    const nextModel = generationModels[next][0][0];
    setKind(next);
    setModel(nextModel);
    setDuration(closestDuration(8, durationOptionsForModel(nextModel)));
  };
  const changeModel = (next: string) => {
    setModel(next);
    setDuration(closestDuration(duration || 8, durationOptionsForModel(next)));
  };
  const submit = async (form: FormData) => {
    setBusy(true);
    try {
      await run("generateDirectContent", {
        ...Object.fromEntries(form.entries()),
        generationType: kind,
        generationModel: model,
        duration: kind === "video" ? duration : undefined
      }, "Generation queued in Publish");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form action={submit} className="generation-form create-generation-form">
      <input type="hidden" name="platform" value={kind === "text" ? "LinkedIn" : "TikTok"} />
      <div className="model-options">
        {generationModels[kind].map(([value, label, price]) => (
          <button type="button" key={value} className={model === value ? "on" : ""} onClick={() => changeModel(value)}>
            <b>{label}</b>
            <span>{price}</span>
          </button>
        ))}
      </div>
      <div className="modal-grid">
        <label>Content type<select value={kind} onChange={(event) => changeKind(event.target.value as "video" | "image" | "text")}>
          <option value="video">Video</option>
          <option value="image">Image / carousel</option>
          <option value="text">Text post</option>
        </select></label>
        {kind === "video" && (
          <>
            <label>Duration (seconds)<select name="duration" value={duration} onChange={(event) => setDuration(event.target.value)}>{durationOptions.map((option) => <option key={option} value={option}>{option} seconds</option>)}</select></label>
            <label>Aspect ratio<select name="aspectRatio" defaultValue="9:16"><option value="9:16">9:16 vertical</option><option value="16:9">16:9 landscape</option><option value="1:1">1:1 square</option></select></label>
          </>
        )}
        {kind === "image" && (
          <>
            <label>Image size<select name="imageSize" defaultValue="1080x1350"><option>1080x1350</option><option>1080x1080</option><option>1920x1080</option></select></label>
            <label>Variants<input name="variants" type="number" min="1" max="4" defaultValue="1" /></label>
          </>
        )}
        {kind === "text" && (
          <>
            <label>Tone<select name="tone" defaultValue="Practical founder-led"><option>Practical founder-led</option><option>Educational</option><option>Contrarian</option><option>Executive concise</option></select></label>
            <label>Length<select name="length" defaultValue="Medium"><option>Short</option><option>Medium</option><option>Long</option></select></label>
          </>
        )}
      </div>
      <label>Generation prompt<textarea name="prompt" defaultValue="Create a founder-led social asset for SME owners about using AI automation to remove repetitive manual work. Use a practical hook, concrete workflow example, clean pacing, and a clear CTA." /></label>
      <label>Caption<textarea name="caption" defaultValue="The fastest automation wins usually hide inside the tasks your team repeats every week." /></label>
      <label>Hashtags<input name="hashtags" defaultValue="#SME, #Automation, #AI" /></label>
      <button className="primary" disabled={busy}><Wand2 size={14} />{busy ? "Generating..." : "Generate"}</button>
    </form>
  );
}

function PublishPanel({ data, run }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<void> }) {
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  }, [run]);
  const queue = [...data.publishQueue].sort((a, b) => new Date(b.createdAt || b.scheduledAt).getTime() - new Date(a.createdAt || a.scheduledAt).getTime());
  const pollIds = queue
    .map((item) => {
      const asset = data.assets.find((entry) => entry.id === item.assetId);
      return item.status === "generating" && asset?.providerTaskId ? asset.id : "";
    })
    .filter(Boolean)
    .join(",");
  useEffect(() => {
    const ids = pollIds.split(",").filter(Boolean);
    if (ids.length === 0) return;
    let cancelled = false;
    const poll = () => {
      if (cancelled) return;
      ids.forEach((id) => runRef.current("pollAsset", { id }, ""));
    };
    poll();
    const timer = window.setInterval(poll, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pollIds]);
  return (
    <div className="publish-page">
      {previewAsset?.assetUrl && <VideoPlayerModal asset={previewAsset} onClose={() => setPreviewAsset(null)} />}
      <section className="plan-hero">
        <div>
          <div className="clbl">Publish</div>
          <h2>Generated drafts and publish queue</h2>
          <p>Generated content appears here first, then moves to Upload-Post once it is done.</p>
        </div>
        <Metric label="Done drafts" value={queue.filter((item) => item.status === "done").length} />
      </section>
      <div className="publish-list">
        {queue.map((item) => {
          const asset = data.assets.find((entry) => entry.id === item.assetId);
          const isVideo = item.generationType === "video" || asset?.type === "video" || asset?.type === "ugc";
          const videoUrl = isVideo ? item.assetUrl || asset?.assetUrl : "";
          return (
            <article className={`publish-card ${isVideo ? "with-video" : ""}`} key={item.id}>
              {isVideo && (
                <button className={`video-thumb ${videoUrl ? "" : "pending"}`} type="button" disabled={!videoUrl} onClick={() => asset?.assetUrl && setPreviewAsset(asset)}>
                  {videoUrl ? <video src={videoUrl} muted preload="metadata" playsInline /> : <Film size={22} />}
                  <span>{videoUrl ? "Preview video" : "Generating video"}</span>
                </button>
              )}
              <div className="publish-main">
                <div className="publish-icon">{item.generationType === "video" ? <Film size={18} /> : item.generationType === "image" ? <Palette size={18} /> : <FileText size={18} />}</div>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.caption || "No caption yet."}</p>
                  <div className="publish-tags">
                    <span>{item.generationType || asset?.type || "draft"}</span>
                    <span>{item.generationModel || item.provider || "local"}</span>
                    {item.duration && <span>{item.duration}s</span>}
                    <span>{new Date(item.createdAt || item.scheduledAt).toLocaleString()}</span>
                  </div>
                  {item.hashtags?.length ? <small>{item.hashtags.join(" ")}</small> : null}
                  {videoUrl && <div className="asset-actions"><button type="button" onClick={() => asset && setPreviewAsset(asset)}><Film size={14} />Play video</button><a className="asset-link" href={`/api/assets/${asset?.id}/download`}>Download MP4</a></div>}
                  {!isVideo && item.assetUrl && <a className="asset-link" href={item.assetUrl} target="_blank">Open generated asset</a>}
                  {item.error && <span className="provider-error inline">{item.error}</span>}
                </div>
              </div>
              <div className="publish-actions">
                <span className={`status ${item.status}`}>{item.status === "done" ? "Done" : item.status}</span>
                {item.status === "generating" && <span className="auto-poll"><RefreshCcw size={13} />Auto-checking</span>}
                {item.status === "done" && <button className="primary" onClick={() => run("publishNow", { id: item.id }, "Upload-Post publish requested for Mariana accounts")}><Send size={14} />Publish now</button>}
              </div>
            </article>
          );
        })}
        {queue.length === 0 && <div className="empty-state">No generated drafts yet. Generate from a content plan to create the first publish item.</div>}
      </div>
    </div>
  );
}

function VideoPlayerModal({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  return (
    <div className="modal-backdrop video-backdrop">
      <section className="video-player-modal">
        <div className="modal-head">
          <div>
            <div className="clbl">Video Preview</div>
            <h3>{asset.title}</h3>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>x</button>
        </div>
        <video src={asset.assetUrl} controls autoPlay playsInline />
        <div className="modal-actions">
          <a className="asset-link" href={`/api/assets/${asset.id}/download`}>Download MP4</a>
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}
function AnalyticsPanel({ data }: { data: AppData }) {
  return <div className="grid three"><Metric label="Engagement forecast" value="4.8%" /><Metric label="Published posts" value={data.publishQueue.filter((p) => p.status === "published").length} /><Metric label="Avg gap score" value={Math.round(data.opportunities.reduce((sum, item) => sum + item.gapScore, 0) / Math.max(1, data.opportunities.length))} /><PanelCard title="Feedback loop"><p>Published assets retain their originating brief, template, platform, and score so future recommendations can learn from performance results.</p></PanelCard></div>;
}

function AutomationPanel({ data, run }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<void> }) {
  return (
    <div className="mock-wrap">
      <PanelCard title="Automation workflows">
        <div className="auto-row">
          <div><b>Weekly research refresh</b><span>Apify trend scan, competitor gap scoring, content plan queue</span></div>
          <button onClick={() => run("refreshTrends", {}, "Workflow run started")}>Run now</button>
        </div>
        <div className="auto-row">
          <div><b>Approved plan to Create Content</b><span>Generate Kie video when a short-video plan is approved</span></div>
          <span className="status scheduled">active</span>
        </div>
        <div className="auto-row">
          <div><b>Publish queue retry</b><span>Retry Upload-Post failures and keep provider request IDs</span></div>
          <span className="status scheduled">active</span>
        </div>
      </PanelCard>
      <PanelCard title="Queue summary">
        <div className="grid three">
          <Metric label="Ready assets" value={data.assets.filter((item) => item.status === "ready").length} />
          <Metric label="Scheduled" value={data.publishQueue.filter((item) => item.status === "scheduled").length} />
          <Metric label="Failed" value={data.publishQueue.filter((item) => item.status === "failed").length} />
        </div>
      </PanelCard>
    </div>
  );
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
    const url = json.access_url || "";
    setConnectUrl(url);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }
  return <div className="grid two"><PanelCard title="Provider status"><div className="provider-list">{Object.entries(integrations || {}).map(([name, value]) => <div className="provider-row" key={name}><b>{name}</b><span className={value.ok || value.configured ? "good" : "bad"}>{value.ok ? "verified" : value.configured ? "configured" : "missing"}</span>{value.status && <small>HTTP {value.status}</small>}{value.error && <small>{value.error}</small>}</div>)}</div></PanelCard><PanelCard title="Connect social accounts"><p className="muted">Demo is configured to Upload-Post profile Mariana and publishes to TikTok, Facebook, and X. Use this only if you need to re-open the connection page.</p><button className="primary" onClick={createConnectUrl}><Megaphone size={14} />Open Mariana connect link</button>{connectUrl && <p className="muted">Connection page opened in a new tab.</p>}{connectError && <p className="provider-error">{connectError}</p>}</PanelCard><PanelCard title="Token handling"><p>Keys are loaded from ignored local environment variables. Rotate the pasted keys before production because they were exposed in chat.</p><code>KIE_API_TOKEN, APIFY_API_TOKEN, UPLOAD_POST_API_KEY</code></PanelCard><PanelCard title="Recommended production shape"><p>GCP Cloud Run or a VPS can run this app later. Keep Postgres, queue, object storage, and provider keys outside the client.</p></PanelCard></div>;
}

function PanelCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="card"><h3>{title}</h3>{children}</section>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="metric"><strong>{value}</strong><span>{label}</span></div>;
}

function compact(value: number) {
  return Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function Score({ value }: { value: number }) {
  return <div className="score"><strong>{value}</strong><span style={{ width: `${value}%` }} /></div>;
}
