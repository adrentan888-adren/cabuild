"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Bug,
  CalendarDays,
  Check,
  ExternalLink,
  Eye,
  FileText,
  Film,
  Mic,
  Lightbulb,
  LogOut,
  Megaphone,
  Palette,
  Plus,
  Radar,
  RefreshCcw,
  Search,
  Settings,
  Sparkles,
  UserRound,
  Wand2
} from "lucide-react";
import type { Asset, BrandKit, Brief, Competitor, CompetitorResult, Opportunity, Platform, PromptTemplates, PublishItem, SocialAudit, Workspace } from "@/lib/types";
import type { PersonaProfile } from "@/lib/types";

type AppData = {
  user: { id: string; email: string; name: string; role: string };
  workspace: Workspace;
  brandKit: BrandKit;
  personaProfile: PersonaProfile;
  competitors: Competitor[];
  competitorResults: CompetitorResult[];
  socialAudits: SocialAudit[];
  connectedSocialAccounts: {
    platform: Platform;
    handle: string;
    displayName: string;
    imageUrl?: string;
    reauthRequired?: boolean;
    url: string;
  }[];
  opportunities: Opportunity[];
  briefs: Brief[];
  assets: Asset[];
  publishQueue: PublishItem[];
  promptTemplates: PromptTemplates;
  researchScans: {
    id: string;
    url: string;
    query?: string;
    dimensions?: {
      actorSources?: string[];
      contentTypes?: string[];
      formats?: string[];
      contentType?: string;
      uploadDate?: string;
      sourceOwnershipFilter?: string;
    };
    platform: Platform;
    minViews: number;
    resultIds: string[];
    createdAt: string;
    completedAt?: string;
    status?: "running" | "done" | "failed";
    source: "apify" | "cache" | "fallback";
    apifyRunId?: string;
    apifyDatasetId?: string;
    apifyActorId?: string;
    error?: string;
  }[];
  activity: { id: string; message: string; createdAt: string }[];
  debugLogs: {
    id: string;
    action: string;
    label: string;
    status: "started" | "success" | "failed" | "info";
    provider?: "apify" | "kie" | "upload-post" | "local" | "system";
    prompt?: string;
    details?: Record<string, unknown>;
    error?: string;
    createdAt: string;
  }[];
};

const platforms: Platform[] = ["TikTok", "Instagram", "LinkedIn", "Facebook", "X"];
const researchActors = [
  { id: "instagram", label: "Instagram" },
  { id: "tiktok", label: "TikTok" },
  { id: "youtube", label: "YouTube" },
  { id: "facebook", label: "Facebook" },
  { id: "linkedin", label: "LinkedIn" }
] as const;
const researchContentTypes = [
  { id: "", label: "All types", description: "All supported formats for this platform" },
  { id: "instagram-reels", label: "Reels", description: "Instagram Reels returned by the Instagram actor" },
  { id: "instagram-posts", label: "Posts", description: "Instagram feed posts returned by the Instagram actor" },
  { id: "article", label: "Articles", description: "LinkedIn Pulse or article-style results" }
] as const;
const researchContentTypeByPlatform: Record<string, string[]> = {
  instagram: ["instagram-reels", "instagram-posts"],
  tiktok: [],
  youtube: [],
  facebook: [],
  linkedin: ["article"]
};
type IntegrationData = Record<string, { configured?: boolean; ok?: boolean; status?: number; error?: string; baseUrl?: string; actor?: string }>;
type PendingPlan = { title: string; description: string; startedAt: number };
type PendingGeneration = { title: string; description: string; kind: GenerationKind; model: string; startedAt: number };
type PlanDraft = {
  topic?: string;
  format?: string;
  description?: string;
  videoPrompt?: string;
  duration?: number | string;
  hooks?: string;
  outline?: string;
  shotList?: string;
  creativeNotes?: string;
  caption?: string;
  hashtags?: string;
  optimalTime?: string;
  expectedPerformance?: string;
};

type GenerationKind = "video" | "image" | "text";
type CreateContentInitial = {
  sourceLabel: string;
  sourceTitle: string;
  sourceDescription: string;
  kind: GenerationKind;
  model?: string;
  duration?: number | string;
  aspectRatio?: string;
  prompt: string;
  caption: string;
  hashtags: string;
  platform?: Platform;
  sourceResultId?: string;
  sourceUrl?: string;
  sourceTitleUrl?: string;
  sourceThumbnailUrl?: string;
  sourceMediaUrl?: string;
  sourceMediaType?: "video" | "image" | "unknown";
};

type SourceMediaPreview = {
  title: string;
  platform?: Platform | string;
  sourceUrl?: string;
  thumbnailUrl?: string;
  mediaUrl?: string;
  mediaType?: "video" | "image" | "unknown";
  description?: string;
};

function proxiedMediaUrl(url?: string) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.includes("cdninstagram.com") || host.includes("fbcdn.net")) return `/api/media-proxy?url=${encodeURIComponent(url)}`;
  } catch {
    return url;
  }
  return url;
}

function renderTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] || "");
}

function researchResultKind(item: CompetitorResult): GenerationKind {
  if (item.mediaType === "image") return "image";
  if (item.mediaType === "video") return "video";
  if (item.platform === "LinkedIn" || item.platform === "X") return "text";
  const text = `${item.title} ${item.description || ""} ${item.url}`.toLowerCase();
  if (/(image|photo|carousel|graphic)/.test(text)) return "image";
  if (/(video|reel|short|watch|tiktok|youtube)/.test(text)) return "video";
  return item.platform === "Instagram" || item.platform === "Facebook" ? "image" : "video";
}

function researchAssetInstruction(kind: GenerationKind) {
  if (kind === "text") return "";
  const media = kind === "image" ? "image" : "video";
  if (kind === "image") return `If the user attaches logo/person references in Step 2, use only those attached assets to replace the original logo/person in the ${media}. If no matching user attachment is provided, remove the original logo and change the person instead of copying the original identity.`;
  return `If the user attaches logo/person/audio references in Step 2, use only those attached assets to replace the original logo/person/audio in the ${media}. If no matching user attachment is provided, remove the original logo, change the person, and replace or change the audio instead of copying the original identity/audio.`;
}

function withSelectedVideoDuration(prompt: string, kind: GenerationKind, duration: number | string | undefined) {
  if (kind !== "video" || !duration) return prompt;
  const line = `the video duration is supposed to be ${duration}s`;
  const withoutExisting = prompt.replace(/(?:^|\n)\s*the video duration is supposed to be \d+\s*s\.?\s*/i, "\n").trim();
  return `${withoutExisting}\n\n${line}`;
}

function createInitialFromResearchResult(item: CompetitorResult, templates: PromptTemplates): CreateContentInitial {
  const kind = researchResultKind(item);
  const sourceMediaUrl = item.mediaUrl || item.thumbnailUrl || item.url;
  const model = kind === "image" ? "gpt-image-2" : kind === "text" ? "gemini-3.5-flash" : "veo-fast";
  const duration = kind === "video" ? closestDuration(item.duration || 8, durationOptionsForModel(model)) : undefined;
  const template = kind === "image" ? templates.researchImageRecreate : kind === "text" ? templates.researchTextRecreate : templates.researchVideoRecreate;
  const basePrompt = kind === "text"
    ? renderTemplate(template, {
      sourceMediaUrl,
      sourceUrl: item.url,
      sourceTitle: item.title,
      sourceDescription: item.description || "",
      durationLine: "",
      assetInstruction: ""
    })
    : renderTemplate(template, {
      sourceMediaUrl,
      sourceUrl: item.url,
      sourceTitle: item.title,
      sourceDescription: item.description || "",
      durationLine: kind === "video" && duration ? `the video duration is supposed to be ${duration}s` : "",
      assetInstruction: researchAssetInstruction(kind)
    });
  const prompt = withSelectedVideoDuration(basePrompt, kind, duration);
  return {
    sourceLabel: "Research result",
    sourceTitle: item.title,
    sourceDescription: item.description || `${item.platform} result with ${compact(item.views)} views.`,
    kind,
    model,
    duration,
    aspectRatio: kind === "image" ? "1:1" : "9:16",
    prompt,
    caption: item.description || item.title,
    hashtags: "",
    platform: item.platform,
    sourceResultId: item.id,
    sourceUrl: item.url,
    sourceThumbnailUrl: item.thumbnailUrl,
    sourceMediaUrl: item.mediaUrl,
    sourceMediaType: item.mediaType
  };
}

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
  const [pendingGeneration, setPendingGeneration] = useState<PendingGeneration | null>(null);
  const [directCreateInitial, setDirectCreateInitial] = useState<CreateContentInitial | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
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

  useEffect(() => {
    if (!pendingGeneration || !data?.publishQueue.length) return;
    const pendingStartedAt = pendingGeneration.startedAt - 30000;
    const hasNewQueueItem = data.publishQueue.some((item) => new Date(item.createdAt || item.scheduledAt).getTime() >= pendingStartedAt);
    if (hasNewQueueItem) setPendingGeneration(null);
  }, [data?.publishQueue, pendingGeneration]);

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
    ["create", "Create Content", Wand2],
    ["publish", "My Contents", CalendarDays],
    ["automation", "Automation", RefreshCcw],
    ["analyse", "Analyse", BarChart3],
    ["logs", "Logs", Bug],
    ["admin", "Backend", Settings]
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
          {profileMenuOpen && (
            <div className="profile-dropup">
              <button onClick={() => { setScreen("persona"); setProfileMenuOpen(false); }}><UserRound size={14} />Persona</button>
              <button onClick={() => { setScreen("settings"); setProfileMenuOpen(false); }}><Settings size={14} />Settings</button>
            </div>
          )}
          <button className={`ws-pill ${profileMenuOpen ? "open" : ""}`} onClick={() => setProfileMenuOpen((open) => !open)} aria-expanded={profileMenuOpen} aria-haspopup="menu">
            <div className="ws-av">ST</div>
            <div>
              <div className="ws-name">{data.user.name}</div>
              <div className="ws-role">{data.user.role}</div>
            </div>
          </button>
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
          {screen === "research" && <IntelligencePanel data={data} run={run} refresh={refresh} setDirectCreateInitial={setDirectCreateInitial} />}
          {screen === "create" && <CreateContentPanel data={data} run={run} setScreen={setScreen} setPendingGeneration={setPendingGeneration} />}
          {screen === "publish" && <PublishPanel data={data} run={run} pendingGeneration={pendingGeneration} />}
          {screen === "automation" && <AutomationPanel data={data} run={run} />}
          {screen === "analyse" && <AnalyticsPanel data={data} />}
          {screen === "logs" && <LogPanel data={data} />}
          {screen === "admin" && <AdminPanel data={data} run={run} integrations={integrations} />}
          {screen === "settings" && <SettingsPanel data={data} run={run} integrations={integrations} />}
        </section>
      </main>
      {directCreateInitial && (
        <ResearchGenerateModal
          initial={directCreateInitial}
          run={run}
          onClose={() => setDirectCreateInitial(null)}
          setScreen={setScreen}
          setPendingGeneration={setPendingGeneration}
        />
      )}
    </div>
  );
}

function title(screen: string) {
  return ({ home: "Home", audit: "Social Audit", persona: "Persona", research: "Research", plan: "Content Plan", create: "Create Content", publish: "My Contents", automation: "Automation", analyse: "Analyse", logs: "Logs", admin: "Backend", settings: "Settings" } as Record<string, string>)[screen];
}

function AnimatedDots({ label }: { label: string }) {
  const [count, setCount] = useState(1);
  useEffect(() => {
    const timer = window.setInterval(() => setCount((value) => value % 3 + 1), 420);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="animated-dots">{label}<span className="dot-slot">{".".repeat(count)}</span></span>;
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
  const [auditElapsed, setAuditElapsed] = useState(0);
  const [connectError, setConnectError] = useState("");
  const autoAuditRef = useRef(false);
  const connectedAccounts = data.connectedSocialAccounts || [];
  const connectedAudits = connectedAccounts
    .map((account) => data.socialAudits.find((audit) => audit.platform === account.platform && audit.handle === account.handle))
    .filter((audit): audit is SocialAudit => Boolean(audit));
  const latestAudit = connectedAudits[0];
  const auditResultIds = new Set(connectedAudits.flatMap((audit) => audit.topResultIds));
  const auditResults = data.competitorResults.filter((item) => auditResultIds.has(item.id));
  const allAuditResults = data.competitorResults.filter((item) => connectedAudits.some((audit) => audit.id === item.competitorId));
  const totalReach = allAuditResults.reduce((sum, item) => sum + item.views, 0);
  const totalLikes = allAuditResults.reduce((sum, item) => sum + item.likes, 0);
  const engagementRate = totalReach > 0 ? (totalLikes / totalReach) * 100 : 0;
  const postsThisWeek = allAuditResults.filter((item) => Date.now() - new Date(item.publishedAt).getTime() <= 1000 * 60 * 60 * 24 * 7).length;
  const followerEstimate = connectedAudits.length ? Math.max(120, Math.round(connectedAudits.reduce((sum, audit) => sum + audit.avgLikes, 0) * 9 + connectedAudits.reduce((sum, audit) => sum + audit.postsAnalysed, 0) * 82)) : 0;
  const averageAuthority = connectedAudits.length ? Math.round(connectedAudits.reduce((sum, audit) => sum + audit.authorityScore, 0) / connectedAudits.length) : 0;
  const accountRows = connectedAccounts.map((account) => {
    const audit = connectedAudits.find((item) => item.platform === account.platform && item.handle === account.handle);
    return { account, audit, score: audit?.authorityScore || 0 };
  });
  const pillarRows = [
    { name: "AI automation writes", score: Math.min(96, averageAuthority + 18), badge: "Strong" },
    { name: "Founder story", score: Math.min(88, averageAuthority + 4), badge: "Avg" },
    { name: "SME productivity tips", score: Math.max(36, averageAuthority - 6), badge: "Avg" },
    { name: "Industry news shares", score: Math.max(22, averageAuthority - 34), badge: "Drop this" }
  ];
  const needsAudit = connectedAccounts.length > 0 && connectedAudits.length < connectedAccounts.filter((account) => !account.reauthRequired).length;

  useEffect(() => {
    if (!auditing) {
      setAuditElapsed(0);
      return;
    }
    const timer = window.setInterval(() => setAuditElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [auditing]);

  useEffect(() => {
    if (autoAuditRef.current || !needsAudit || auditing) return;
    autoAuditRef.current = true;
    setAuditing(true);
    run("auditConnectedSocials", {}, "Connected social audits completed").finally(() => setAuditing(false));
  }, [auditing, needsAudit, run]);

  async function connectSocialMedia() {
    setConnectError("");
    const res = await fetch("/api/integrations/upload-post/connect", { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_url) {
      setConnectError(json.error || "Unable to create Upload-Post connection link.");
      return;
    }
    window.open(json.access_url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="audit-page">
      <div className="audit-title-row">
        <div>
          <div className="clbl">Social Audit</div>
          <h2>{connectedAccounts.length ? "Connected social authority dashboard" : "Connect social media to start the audit"}</h2>
          <p>{connectedAccounts.length ? `${connectedAccounts.length} connected account${connectedAccounts.length === 1 ? "" : "s"} from Upload-Post profile Mariana` : "Connect through Upload-Post first. Only connected accounts are audited and shown here."}</p>
        </div>
        <button className="primary" onClick={connectSocialMedia}><Megaphone size={14} />Connect social media</button>
      </div>

      {connectError && <p className="provider-error">{connectError}</p>}
      {auditing && <div className="scan-progress"><span />Analysing all connected social accounts with Apify<b>{auditElapsed}s</b></div>}

      <section className="card">
        <div className="audit-hero">
          <div className="score-ring"><div><strong>{averageAuthority}</strong><span>Authority</span></div></div>
          <div className="audit-mets">
            <div><b>{compact(totalReach)}</b><span>Total reach</span><small className="good">Connected accounts only</small></div>
            <div><b>{engagementRate.toFixed(1)}%</b><span>Engagement rate</span><small className="good">{connectedAudits.length} audited</small></div>
            <div><b>{postsThisWeek}</b><span>Posts this week</span><small className="warn">Target: 10</small></div>
            <div><b>+{compact(followerEstimate)}</b><span>Follower signal</span><small className="good">Estimated from engagement</small></div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="clbl">Connected account breakdown</div>
        {accountRows.length === 0 && <div className="empty-state">No social media accounts connected yet.</div>}
        {accountRows.map(({ account, audit, score }) => (
          <div className="pb-row audit-pb account-row" key={`${account.platform}-${account.handle}`}>
            {account.imageUrl ? <img src={account.imageUrl} alt="" /> : <span className="account-avatar">{account.platform.slice(0, 1)}</span>}
            <span className="pb-nm">{account.platform}<small>{account.displayName} @{account.handle}</small></span>
            <div className="pb-tr"><span style={{ width: `${score}%`, background: score < 40 ? "#E24B4A" : score < 55 ? "#EF9F27" : "#378ADD" }} /></div>
            <span className="pb-sc">{audit ? `${score} / 100` : account.reauthRequired ? "Reconnect" : "Pending"}</span>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="clbl">Engagement trend - connected accounts</div>
        <svg className="audit-trend" width="100%" height="72" viewBox="0 0 640 72" preserveAspectRatio="none">
          <path d="M0 60 L46 55 L91 50 L137 53 L183 45 L229 40 L274 37 L320 33 L366 30 L411 23 L457 17 L503 13 L549 10 L594 7 L640 4" fill="none" stroke="#378ADD" strokeWidth="2" strokeLinecap="round" />
          <path d="M0 60 L46 55 L91 50 L137 53 L183 45 L229 40 L274 37 L320 33 L366 30 L411 23 L457 17 L503 13 L549 10 L594 7 L640 4 L640 72 L0 72Z" fill="rgba(55,138,221,.12)" />
        </svg>
        <div className="trend-axis"><span>Day 1</span><span>Day 4</span><span>Day 7</span><span>Day 10</span><span>Day 14</span></div>
      </section>

      <section className="card">
        <div className="clbl">Content pillar ratings</div>
        {pillarRows.map((item) => (
          <div className="pr-row" key={item.name}>
            <span className="pr-nm">{item.name}</span>
            <div className="pr-tr"><span style={{ width: `${item.score}%` }} /></div>
            <span className={`pr-b ${item.badge === "Strong" ? "bs" : item.badge === "Drop this" ? "bd" : "ba"}`}>{item.badge}</span>
          </div>
        ))}
      </section>

      {auditResults.length > 0 && (
        <section className="card">
          <div className="clbl">Top posts from connected accounts</div>
          <div className="top-posts">
            {auditResults.slice(0, 8).map((item, index) => (
              <a className="tp-row" key={item.id} href={item.url} target="_blank">
                <span className="tp-rank">{index + 1}</span>
                <div className="tp-text">{item.title}<small>{item.platform} - {new Date(item.publishedAt).toLocaleString()}</small></div>
                <span className="tp-er">{item.views > 0 ? `${((item.likes / item.views) * 100).toFixed(1)}%` : "0%"}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <div className="clbl">AI diagnostic</div>
        <div className="diag">
          {connectedAudits.length ? (
            <>Your connected channels average <b>{averageAuthority}/100 authority</b> across {connectedAudits.length} audited account{connectedAudits.length === 1 ? "" : "s"}. TikTok, Facebook, and X results are scraped from the connected handles returned by Upload-Post, then scored from views, likes, posting recency, and top-post engagement.</>
          ) : (
            <>Connect social media first. Once Upload-Post returns connected accounts, this page automatically scans those social pages and shows only their audit results.</>
          )}
        </div>
      </section>
    </div>
  );
}

const personaSteps = ["Identity", "Audience", "Voice", "Rules", "References"];

function listValue(items?: string[]) {
  return (items || []).join(", ");
}

function PersonaChips({ items }: { items?: string[] }) {
  const values = (items || []).filter(Boolean);
  if (!values.length) return <span className="persona-empty">No entries yet</span>;
  return <div className="persona-chip-row">{values.map((item) => <span className="persona-chip" key={item}>{item}</span>)}</div>;
}

function PersonaRange({ name, left, right, value }: { name: string; left: string; right: string; value: number }) {
  const [current, setCurrent] = useState(value);
  return (
    <div className="persona-slider">
      <span>{left}</span>
      <input name={name} type="range" min="1" max="5" step="1" value={current} onChange={(event) => setCurrent(Number(event.target.value))} />
      <b>{current}</b>
      <span>{right}</span>
    </div>
  );
}

function PersonaFileField({ name, title, helper, accept, initial }: { name: string; title: string; helper: string; accept: string; initial?: string }) {
  const [fileName, setFileName] = useState(initial || "");
  return (
    <label className={`persona-upload ${fileName ? "selected" : ""}`}>
      <input type="file" accept={accept} onChange={(event) => setFileName(event.currentTarget.files?.[0]?.name || "")} />
      <input type="hidden" name={name} value={fileName} />
      <UserRound size={20} />
      <b>{title}</b>
      <span>{fileName || helper}</span>
    </label>
  );
}

function PersonaPanel({ data, run }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<void> }) {
  const [step, setStep] = useState(0);
  const [showAutofill, setShowAutofill] = useState(false);
  const [autoFilling, setAutoFilling] = useState(false);
  const persona = data.personaProfile;
  const completionChecks = [
    persona.fullName,
    persona.jobTitle,
    persona.company,
    persona.primaryAudience,
    persona.painPoint,
    persona.naturalPhrases.length,
    persona.approvedTopics.length,
    persona.strongOpinions,
    persona.writingSamples.length
  ];
  const completion = Math.round((completionChecks.filter(Boolean).length / completionChecks.length) * 100);
  const save = async (form: FormData) => {
    await run("updatePersonaProfile", Object.fromEntries(form.entries()), "Persona saved");
  };
  const autoFill = async (form?: HTMLFormElement | null) => {
    if (!form || autoFilling) return;
    setAutoFilling(true);
    await run("autoFillPersonaProfile", Object.fromEntries(new FormData(form).entries()), "Persona auto-filled from public profiles");
    setAutoFilling(false);
  };
  const saveAndGo = async (targetStep: number, form?: HTMLFormElement | null) => {
    if (targetStep === step) return;
    if (form) await save(new FormData(form));
    setStep(Math.min(personaSteps.length - 1, Math.max(0, targetStep)));
  };
  return (
    <div className="persona-page">
      <div className="drift-banner">
        <div><b>Persona setup</b> - Store one active founder profile. Saving or auto-filling replaces the current profile.</div>
        <span className="badge">Single active profile</span>
      </div>

      <section className="persona-hero">
        <div>
          <div className="msub">Module 1 - Persona</div>
          <h2>Reference persona</h2>
          <p>Choose a starting path, then complete the five setup steps. Updates replace this profile instead of creating another one.</p>
        </div>
        <span className="last-upd">{persona.updatedAt ? `Updated ${new Date(persona.updatedAt).toLocaleString()}` : "Not saved yet"}</span>
      </section>

      <div className="path-grid persona-paths">
        <button className="path-card featured" onClick={() => setShowAutofill(true)}>
          <Search size={20} />
          <b>Learn from a channel</b>
          <span>Paste public social or website URLs to store as future autofill sources.</span>
        </button>
        <button className="path-card" onClick={() => setStep(0)}>
          <FileText size={20} />
          <b>Start from scratch</b>
          <span>Fill in your own persona details manually across 5 steps.</span>
        </button>
      </div>

      <section className="persona-summary">
        <Metric label="Profile completion" value={`${completion}%`} />
        <Metric label="Tone" value={`${persona.toneFormalCasual}/${persona.toneSeriousHumorous}/${persona.toneReservedBold}`} />
        <Metric label="Approved topics" value={persona.approvedTopics.length} />
      </section>

      <form action={save} className="persona-setup">
        <div className="persona-step-head">
          <h3>Persona setup</h3>
          <span className="badge">Step {step + 1} of 5</span>
        </div>
        <div className="step-nav">
          {personaSteps.map((label, index) => (
            <button type="button" key={label} className={`step-dot ${index === step ? "active" : index < step ? "done" : ""}`} onClick={(event) => saveAndGo(index, event.currentTarget.form)} title={label}><span>{index + 1}</span>{label}</button>
          ))}
        </div>

        {showAutofill && (
          <section className="persona-card">
            <div className="persona-card-head">
              <div>
                <div className="clbl">Auto-fill sources</div>
                <h3>Online presence URLs</h3>
              </div>
              <button type="button" onClick={() => setShowAutofill(false)}>Close</button>
            </div>
            <p className="muted">Apify crawls public snippets from these URLs, then GPT-5.5 in Kie maps the findings into your persona fields.</p>
            <div className="grid two">
              <label>LinkedIn<input name="linkedinUrl" defaultValue={persona.sourceUrls.linkedin} placeholder="linkedin.com/in/yourname" /></label>
              <label>Facebook<input name="facebookUrl" defaultValue={persona.sourceUrls.facebook || ""} placeholder="facebook.com/yourprofile" /></label>
              <label>Website<input name="websiteUrl" defaultValue={persona.sourceUrls.website} placeholder="yourcompany.com" /></label>
              <label>Instagram<input name="instagramUrl" defaultValue={persona.sourceUrls.instagram} placeholder="instagram.com/yourhandle" /></label>
              <label>X / Twitter<input name="xUrl" defaultValue={persona.sourceUrls.x} placeholder="x.com/yourhandle" /></label>
            </div>
            <div className="autofill-actions">
              <button type="button" className="primary" onClick={(event) => autoFill(event.currentTarget.form)} disabled={autoFilling}>{autoFilling ? <AnimatedDots label="Auto-filling persona" /> : "Auto-fill persona"}</button>
              <span>Uses only public crawl results. Review and edit the saved persona after auto-fill.</span>
            </div>
          </section>
        )}

        <section className="persona-card">
          {step === 0 && (
            <div className="persona-fields">
              <div className="autofill-banner"><span className="dot" /><span>Skip the form - crawl public URLs and auto-fill with GPT-5.5.</span><button type="button" onClick={() => setShowAutofill(true)}>Auto-fill</button></div>
              <div className="grid two">
                <label>Full name<input name="fullName" defaultValue={persona.fullName} placeholder="Sean Tan" /></label>
                <label>Job title<input name="jobTitle" defaultValue={persona.jobTitle} placeholder="CEO" /></label>
              </div>
              <label>Company<input name="company" defaultValue={persona.company} placeholder="Acme Ventures" /></label>
              <label>Industry<select name="industry" defaultValue={persona.industry}><option>Technology</option><option>Finance</option><option>Healthcare</option><option>E-commerce</option><option>Education</option><option>Consulting</option></select></label>
              <div className="persona-advanced">
                <div className="clbl">Advanced fields</div>
                <label>Preferred name<input name="preferredName" defaultValue={persona.preferredName} placeholder="Sean" /></label>
                <label>Company one-liner<input name="companyOneLiner" defaultValue={persona.companyOneLiner} placeholder="We help SMEs automate ops with AI" /></label>
                <div className="grid two">
                  <label>Years of experience<select name="yearsExperience" defaultValue={persona.yearsExperience}><option value="">Select...</option><option>1-3</option><option>4-7</option><option>8-12</option><option>13-20</option><option>20+</option></select></label>
                  <label>Pronouns<select name="pronouns" defaultValue={persona.pronouns}><option>I (first person)</option><option>We (company voice)</option><option>Both</option></select></label>
                </div>
                <label>Credential tags<input name="credentialTags" defaultValue={listValue(persona.credentialTags)} placeholder="Forbes 30u30, Ex-founder" /></label>
                <PersonaChips items={persona.credentialTags} />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="persona-fields">
              <label>Primary audience<input name="primaryAudience" defaultValue={persona.primaryAudience} placeholder="Mid-market ops managers in SEA" /></label>
              <label>Their biggest pain point<textarea name="painPoint" defaultValue={persona.painPoint} placeholder="Too many manual processes slowing their team down..." /></label>
              <label>Content language<select name="contentLanguage" defaultValue={persona.contentLanguage}><option>English only</option><option>English + BM</option><option>English + Mandarin</option><option>Manglish</option><option>Multi-language</option></select></label>
              <div className="persona-advanced">
                <div className="clbl">Deeper audience insight</div>
                <label>Audience's biggest fear<input name="audienceFear" defaultValue={persona.audienceFear} placeholder="Being replaced by AI or falling behind competitors" /></label>
                <label>Audience's biggest aspiration<input name="audienceAspiration" defaultValue={persona.audienceAspiration} placeholder="Run a leaner, faster, more profitable operation" /></label>
                <label>Secondary audience<input name="secondaryAudience" defaultValue={persona.secondaryAudience} placeholder="Investors, potential hires..." /></label>
                <label className="toggle-line"><span>Include personal life in content</span><span><input type="hidden" name="includePersonalLife" value="false" /><input name="includePersonalLife" type="checkbox" value="true" defaultChecked={persona.includePersonalLife} /></span></label>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="persona-fields">
              <div className="clbl">Tone</div>
              <PersonaRange name="toneFormalCasual" left="Formal" right="Casual" value={persona.toneFormalCasual} />
              <PersonaRange name="toneSeriousHumorous" left="Serious" right="Humorous" value={persona.toneSeriousHumorous} />
              <PersonaRange name="toneReservedBold" left="Reserved" right="Bold" value={persona.toneReservedBold} />
              <div className="persona-advanced">
                <div className="clbl">Vocabulary control</div>
                <label>Natural phrases<input name="naturalPhrases" defaultValue={listValue(persona.naturalPhrases)} placeholder="Here's the thing, Real talk" /></label>
                <PersonaChips items={persona.naturalPhrases} />
                <label>Banned vocabulary<input name="bannedVocabulary" defaultValue={listValue(persona.bannedVocabulary)} placeholder="synergy, disruptive" /></label>
                <PersonaChips items={persona.bannedVocabulary} />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="persona-fields">
              <label>Primary content goal<select name="primaryContentGoal" defaultValue={persona.primaryContentGoal}><option>Thought leadership</option><option>Lead generation</option><option>Brand awareness</option><option>Hiring</option><option>Investor relations</option></select></label>
              <label>CTA style<select name="ctaStyle" defaultValue={persona.ctaStyle}><option>Soft</option><option>Hard</option><option>None</option><option>Mixed</option></select></label>
              <div className="persona-advanced">
                <div className="clbl">Topic boundaries</div>
                <label>Approved topics<input name="approvedTopics" defaultValue={listValue(persona.approvedTopics)} placeholder="AI automation, founder productivity" /></label>
                <PersonaChips items={persona.approvedTopics} />
                <label>Off-limits topics<input name="offLimitsTopics" defaultValue={listValue(persona.offLimitsTopics)} placeholder="Politics, medical advice" /></label>
                <PersonaChips items={persona.offLimitsTopics} />
                <label>Strong opinions<textarea name="strongOpinions" defaultValue={persona.strongOpinions} placeholder="AI will not replace jobs - it replaces tasks." /></label>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="persona-fields">
              <label>Writing samples<textarea name="writingSamples" defaultValue={listValue(persona.writingSamples)} placeholder="Paste up to 3 samples, separated by a blank line or comma." /></label>
              <div className="persona-advanced">
                <div className="clbl">Face & voice AI references</div>
                <div className="grid two">
                  <PersonaFileField name="faceReferenceFileName" title="Face reference" helper="Upload photo" accept="image/*" initial={persona.faceReferenceFileName} />
                  <PersonaFileField name="voiceSampleFileName" title="Voice sample" helper="Upload recording" accept="audio/*" initial={persona.voiceSampleFileName} />
                </div>
                <div className="clbl">PDPA consent</div>
                <label className="toggle-line"><span>Allow AI face generation</span><span><input type="hidden" name="allowAiFace" value="false" /><input name="allowAiFace" type="checkbox" value="true" defaultChecked={persona.allowAiFace} /></span></label>
                <label className="toggle-line"><span>Allow AI voice cloning</span><span><input type="hidden" name="allowAiVoice" value="false" /><input name="allowAiVoice" type="checkbox" value="true" defaultChecked={persona.allowAiVoice} /></span></label>
                <label className="toggle-line"><span>Auto-apply AI disclosure label</span><span><input type="hidden" name="autoAiDisclosure" value="false" /><input name="autoAiDisclosure" type="checkbox" value="true" defaultChecked={persona.autoAiDisclosure} /></span></label>
              </div>
            </div>
          )}
        </section>

        <div className="persona-footer">
          <button type="button" onClick={(event) => saveAndGo(step - 1, event.currentTarget.form)} disabled={step === 0}>Back</button>
          <div className="row-actions">
            <button type="button" onClick={(event) => saveAndGo(step + 1, event.currentTarget.form)} disabled={step === personaSteps.length - 1}>Continue</button>
            <button className="primary" type="submit"><Check size={14} />Save persona</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function IntelligencePanel({ data, run, refresh, setDirectCreateInitial }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<any>; refresh: () => Promise<void>; setDirectCreateInitial: (initial: CreateContentInitial) => void }) {
  const [searchMode, setSearchMode] = useState<"url" | "keywords">("url");
  const [sortBy, setSortBy] = useState<"views" | "likes" | "date">("views");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [sortOpen, setSortOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeScanId, setActiveScanId] = useState<string | null>(data.researchScans[0]?.id || null);
  const [keywordText, setKeywordText] = useState("");
  const [actorSource, setActorSource] = useState("instagram");
  const [contentType, setContentType] = useState("");
  const [uploadDate, setUploadDate] = useState("");
  const [scanStatus, setScanStatus] = useState<"url" | "keywords" | null>(null);
  const [pendingScan, setPendingScan] = useState<"url" | "keywords" | null>(null);
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
  const [scanElapsed, setScanElapsed] = useState(0);
  const [sourcePreview, setSourcePreview] = useState<SourceMediaPreview | null>(null);
  const activeScan = data.researchScans.find((scan) => scan.id === activeScanId) || data.researchScans[0];
  const availableContentTypes = useMemo(
    () => [
      researchContentTypes[0],
      ...(researchContentTypeByPlatform[actorSource] || []).map((id) => researchContentTypes.find((item) => item.id === id)).filter(Boolean) as typeof researchContentTypes[number][]
    ],
    [actorSource]
  );
  const activeScanStatus = scanStatus || pendingScan || (activeScan?.status === "running" ? (activeScan.query ? "keywords" : "url") : null);
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
    if (!activeScanStatus) {
      setScanElapsed(0);
      return;
    }
    const startedAt = scanStartedAt || (activeScan?.status === "running" ? new Date(activeScan.createdAt).getTime() : Date.now());
    const tick = () => setScanElapsed(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [activeScanStatus, scanStartedAt, activeScan?.createdAt, activeScan?.status]);
  useEffect(() => {
    if (contentType && !availableContentTypes.some((item) => item.id === contentType)) setContentType("");
  }, [actorSource, availableContentTypes, contentType]);
  useEffect(() => {
    if (!activeScan || activeScan.status !== "running") return;
    let cancelled = false;
    const sync = async () => {
      await post("syncResearchScan", { id: activeScan.id }).catch(() => null);
      if (!cancelled) await refresh();
    };
    void sync();
    const timer = window.setInterval(sync, 7000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeScan?.id, activeScan?.status, refresh]);
  const chooseSort = (next: "views" | "likes" | "date") => {
    if (next === sortBy) setSortDir((dir) => (dir === "desc" ? "asc" : "desc"));
    else {
      setSortBy(next);
      setSortDir("desc");
    }
    setSortOpen(false);
  };
  const scanUrl = async (form: FormData) => {
    flushSync(() => {
      setPendingScan("url");
      setScanStatus("url");
      setScanStartedAt(Date.now());
    });
    try {
      const result = await run("scanResearchUrl", Object.fromEntries(form.entries()), "Research scan started. You can leave and come back later.");
      if (result?.id) setActiveScanId(result.id);
    } finally {
      setScanStatus(null);
      setPendingScan(null);
      setScanStartedAt(null);
    }
  };
  const scanKeywords = async (form: FormData) => {
    flushSync(() => {
      setPendingScan("keywords");
      setScanStatus("keywords");
      setScanStartedAt(Date.now());
    });
    try {
      const result = await run("scanKeywordResearch", {
        keywords: keywordText,
        minViews: Number(form.get("minViews") || 0),
        dimensions: { actorSources: [actorSource], contentType, contentTypes: contentType ? [contentType] : [], uploadDate }
      }, "Keyword research complete");
      if (result?.id) setActiveScanId(result.id);
    } finally {
      setScanStatus(null);
      setPendingScan(null);
      setScanStartedAt(null);
    }
  };
  const generateContentFromResearch = (item: CompetitorResult) => {
    setDirectCreateInitial(createInitialFromResearchResult(item, data.promptTemplates));
  };
  const openSourcePreview = (item: CompetitorResult) => {
    setSourcePreview({
      title: item.title,
      platform: item.platform,
      sourceUrl: item.url,
      thumbnailUrl: item.thumbnailUrl,
      mediaUrl: item.mediaUrl,
      mediaType: item.mediaType,
      description: item.description
    });
  };
  const selectedActor = researchActors.find((item) => item.id === actorSource);
  const selectedContentType = availableContentTypes.find((item) => item.id === contentType);
  const scanLabel = (scanItem: AppData["researchScans"][number]) => scanItem.query || (scanItem.url.startsWith("keyword:") ? scanItem.url.split("|")[0].replace("keyword:", "") : scanItem.url);
  return (
    <div className="research-page">
      {sourcePreview && <SourceMediaModal source={sourcePreview} onClose={() => setSourcePreview(null)} />}
      <section className="research-hero">
        <div>
          <div className="clbl">Research</div>
          <h2>Find competitor posts worth turning into content</h2>
          <p>URL scans stay scoped to the submitted profile/page. Keyword scans search one selected platform and optional content type, then sort qualified posts by views, likes, or date.</p>
        </div>
        <div className="history-wrap">
          <button onClick={() => setHistoryOpen((open) => !open)}>History</button>
          {historyOpen && (
            <div className="history-menu">
              {data.researchScans.slice(0, 10).map((scanItem) => (
                <button key={scanItem.id} onClick={() => { setActiveScanId(scanItem.id); setHistoryOpen(false); }}>
                  <b>{scanItem.query ? "Keyword search" : scanItem.platform}</b>
                  <span>{scanLabel(scanItem)}</span>
                  <small>{scanItem.status === "running" ? "Scanning in background" : new Date(scanItem.createdAt).toLocaleString()} ﾂｷ min {compact(scanItem.minViews)}</small>
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
            <label>Social URL<input name="url" type="url" placeholder="LinkedIn profile/page, TikTok, Instagram, YouTube, Facebook, or X URL" required /></label>
            <label>Minimum views<input name="minViews" type="number" min="0" step="1" defaultValue="0" /></label>
            <button
              type="button"
              className="primary"
              disabled={activeScanStatus !== null}
              aria-busy={activeScanStatus === "url"}
              onClick={(event) => {
                const form = event.currentTarget.form;
                if (!form || activeScanStatus) return;
                if (!form.reportValidity()) return;
                void scanUrl(new FormData(form));
              }}
            >
              <Radar size={14} />{activeScanStatus === "url" ? "Scanning..." : "Scan"}
            </button>
          </form>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); if (!activeScanStatus) void scanKeywords(new FormData(event.currentTarget)); }} className="keyword-form">
            <div className="keyword-input-row">
              <label>Keywords<input name="keywords" value={keywordText} onChange={(event) => setKeywordText(event.target.value)} placeholder="Enter keywords, e.g. sheila majid" required /></label>
              <label>Minimum views<input name="minViews" type="number" min="0" step="1" defaultValue="0" /></label>
              <button
                type="button"
                className="primary"
                disabled={activeScanStatus !== null}
                aria-busy={activeScanStatus === "keywords"}
                onClick={(event) => {
                  const form = event.currentTarget.form;
                  if (!form || activeScanStatus) return;
                  if (!form.reportValidity()) return;
                  void scanKeywords(new FormData(form));
                }}
              >
                <Search size={14} />{activeScanStatus === "keywords" ? "Scanning..." : "Search"}
              </button>
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
              <ContentTypeSelector selected={contentType} onSelect={setContentType} items={availableContentTypes} platform={selectedActor?.label || "Instagram"} />
              <div className="research-filter-summary">
                <b>Apify query scope</b>
                <span>Platform: {selectedActor?.label || "Instagram"} · Type: {selectedContentType?.label || "All types"} · Upload date: {uploadDate ? uploadDate.replace("-", " ") : "Any time"}</span>
                <small>Native Apify filters are used where available; otherwise results are classified and filtered after scraping. Workspace niche is not injected.</small>
              </div>
            </div>
          </form>
        )}
        {activeScanStatus && <div className="scan-progress"><span />{activeScanStatus === "keywords" ? "Searching Apify in the background. You can leave this page and come back later." : "Scanning only the submitted URL/profile with Apify in the background. You can leave this page and come back later."}<b>{scanElapsed}s</b></div>}
        {!activeScanStatus && activeScan && activeScan.status !== "failed" && (
          <div className={`scan-outcome ${activeScan.source}`}>
            {activeScan.source === "apify" ? "Apify search completed" : "Fallback results shown"}
            <b>{activeScanResultCount}</b>
            <span>qualified results</span>
          </div>
        )}
        {activeScan?.status === "failed" && <p className="provider-error">Apify scan failed: {activeScan.error}</p>}
        {activeScan?.status !== "failed" && activeScan?.error && <p className="provider-error">Apify fallback used: {activeScan.error}</p>}
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
              <b>{activeScanStatus === "keywords" ? "Background keyword scan saved" : "Background URL scan saved"}</b>
              <p>Apify is collecting and filtering results now. You can switch tabs, leave Research, refresh, or come back later; this scan will stay in History until it finishes.</p>
              <div><span /></div>
            </div>
          )}
          <div className={activeScanStatus ? "stale-results" : "fresh-results"}>
          {sortedResults.map((item, index) => (
            <article className="result-row" key={item.id}>
              <div className="result-rank">{index + 1}</div>
              <div className="result-thumb">{item.thumbnailUrl ? <img src={proxiedMediaUrl(item.thumbnailUrl)} alt="" /> : <span>{item.platform.slice(0, 2).toUpperCase()}</span>}</div>
              <div className="result-main">
                <button className="result-title-button" type="button" onClick={() => openSourcePreview(item)}>{item.title}</button>
                <span>{new Date(item.publishedAt).toLocaleString()} ﾂｷ captured {new Date(item.capturedAt).toLocaleDateString()}</span>
                {item.description && <small>{item.description}</small>}
              </div>
              <div className="result-stat"><b>{compact(item.views)}</b><span>views</span></div>
              <div className="result-stat"><b>{compact(item.likes)}</b><span>likes</span></div>
              <div className="result-actions">
                <button type="button" onClick={() => openSourcePreview(item)}><Eye size={14} />Preview</button>
                <a href={item.url} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open</a>
                <button className="plan-action generate-action" onClick={() => generateContentFromResearch(item)}><Wand2 size={14} />Generate Content</button>
              </div>
            </article>
          ))}
          </div>
          {sortedResults.length === 0 && !activeScanStatus && <div className="empty-state">{activeScan ? "Search completed, but no content matched the selected minimum views and filters. Generate Content appears beside each result entry, so lower the minimum views, broaden the filters, or open a previous non-empty scan from History." : "No qualified results yet. Search by URL or keywords to begin."}</div>}
        </div>
      </section>

    </div>
  );
}

function ActorSourceSelector({ selected, onSelect }: { selected: string; onSelect: (item: string) => void }) {
  return (
    <div className="content-type-group">
      <b>Platform</b>
      <div>
        {researchActors.map((item) => (
          <button type="button" key={item.id} className={selected === item.id ? "on" : ""} onClick={() => onSelect(item.id)}>
            <span><input type="radio" checked={selected === item.id} readOnly tabIndex={-1} />{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ContentTypeSelector({ selected, onSelect, items, platform }: { selected: string; onSelect: (item: string) => void; items: typeof researchContentTypes[number][]; platform: string }) {
  return (
    <div className="content-type-group">
      <b>Content type</b>
      <small>{platform} supports {items.filter((item) => item.id).map((item) => item.label.toLowerCase()).join(", ")} in keyword research.</small>
      <div>
        {items.map((item) => (
          <button type="button" key={item.id || "all"} className={selected === item.id ? "on" : ""} onClick={() => onSelect(item.id)}>
            <span><input type="radio" checked={selected === item.id} readOnly tabIndex={-1} />{item.label}</span>
            <small>{item.description}</small>
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
  "Image 1:1",
  "Image 4:5",
  "Image 16:9",
  "Image 9:16",
  "Text post",
  "Long-form article"
];

const generationModels = {
  video: [
    ["veo-fast", "Veo Fast", "$0.05-0.12/sec est."],
    ["seedance-2.0", "Seedance 2.0", "$0.04-0.10/sec est."]
  ],
  image: [
    ["gpt-image-2", "GPT-image 2", "$0.04-0.12/image est."],
    ["nanobanana-pro", "Nanobanana Pro", "$0.03-0.08/image est."]
  ],
  text: [
    ["gemini-3.5-flash", "Gemini 3.5 Flash", "<$0.01/post est."],
    ["claude-opus-4.8", "Claude Opus 4.8", "$0.02-0.10/post est."]
  ]
} as const;

type AssetReference = { role: "product photo" | "avatar/persona" | "logo" | "audio"; fileName: string; previewUrl: string; file: File };
type GenerationAssetReference = Pick<AssetReference, "role" | "fileName"> & { url?: string; storageKey?: string; contentType?: string };

function createContentInitialFromDraft(draft: PlanDraft): CreateContentInitial {
  const format = draft.format && contentFormatOptions.includes(draft.format) ? draft.format : "Short video 9:16";
  const kind = planContentKind(format);
  return {
    sourceLabel: "AI generated draft",
    sourceTitle: draft.topic || "AI generated content",
    sourceDescription: draft.description || "Generated from your Create Content instruction. Review and adjust before generating.",
    kind,
    duration: kind === "video" ? draft.duration || defaultPlanDuration(format) || 8 : undefined,
    aspectRatio: defaultAspectRatioForFormat(format),
    prompt: draft.videoPrompt || draft.description || draft.topic || "",
    caption: draft.caption || "",
    hashtags: draft.hashtags || "",
    platform: defaultPlatformForKind(kind)
  };
}

function preferredFormatForKind(kind: GenerationKind, aspectRatio?: string) {
  if (kind === "image") {
    const ratio = aspectRatio === "1:1" || aspectRatio === "4:5" || aspectRatio === "16:9" || aspectRatio === "9:16" ? aspectRatio : "4:5";
    return `Image ${ratio}`;
  }
  if (kind === "text") return "Text post";
  return aspectRatio === "16:9" ? "Long-form video 16:9" : "Short video 9:16";
}

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

function defaultAspectRatioForFormat(format?: string) {
  if (format?.includes("1:1")) return "1:1";
  if (format?.includes("4:5")) return "4:5";
  if (format?.includes("16:9")) return "16:9";
  return "9:16";
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

function defaultPlatformForKind(kind: GenerationKind): Platform {
  if (kind === "text") return "LinkedIn";
  if (kind === "image") return "Instagram";
  return "TikTok";
}

async function uploadAssetReferences(refs: AssetReference[]): Promise<GenerationAssetReference[]> {
  const uploaded: GenerationAssetReference[] = [];
  for (const ref of refs) {
    const form = new FormData();
    form.set("role", ref.role);
    form.set("file", ref.file);
    const res = await fetch("/api/uploads", { method: "POST", body: form });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `Upload failed for ${ref.fileName}`);
    uploaded.push({
      role: ref.role,
      fileName: ref.fileName,
      url: String(json.url || ""),
      storageKey: String(json.storageKey || ""),
      contentType: String(json.contentType || ref.file.type || "")
    });
  }
  return uploaded;
}

function placementsForKind(kind: GenerationKind) {
  if (kind === "video") return ["TikTok", "FB/IG Reels", "YouTube Shorts"];
  if (kind === "image") return ["Instagram", "LinkedIn", "Facebook"];
  return ["LinkedIn", "X", "Threads"];
}

function referenceLabel(ref: GenerationAssetReference) {
  return `"${ref.fileName}"${ref.url ? ` at ${ref.url}` : ""}`;
}

function enrichPromptForSocialConversion(basePrompt: string, kind: GenerationKind, refs: GenerationAssetReference[]) {
  const mediaLabel = kind === "image" ? "image" : kind === "video" ? "video" : "post";
  const conversionDirection = `Optimize this ${mediaLabel} for high-conversion, high-quality social media publishing: use a strong opening hook, platform-native pacing or layout, clear visual hierarchy, specific benefit language, and a direct CTA.`;
  if (kind === "text" || refs.length === 0) return [basePrompt, conversionDirection].filter(Boolean).join("\n\n");
  const productRef = refs.find((ref) => ref.role === "product photo");
  const avatarRef = refs.find((ref) => ref.role === "avatar/persona");
  const logoRef = refs.find((ref) => ref.role === "logo");
  const audioRef = refs.find((ref) => ref.role === "audio");
  const lines = [
    productRef ? `- Product photo reference ${referenceLabel(productRef)}: include the product/photo visibly as a main visual element. Preserve its important details and integrate it naturally into the scene/composition.` : "",
    avatarRef ? `- Avatar/persona reference ${referenceLabel(avatarRef)}: use this as the on-screen person/creator/persona reference. Keep the face/persona recognizable and consistent with the uploaded reference.` : "",
    logoRef ? `- Logo reference ${referenceLabel(logoRef)}: include this exact brand logo clearly in the ${mediaLabel}, preferably in a clean corner, product lockup, end frame, or brand-safe area. Do not replace it with generic text or an invented logo.` : "",
    audioRef && kind === "video" ? `- Audio reference ${referenceLabel(audioRef)}: use this only as the user-approved audio direction. Replace the source video's original audio with a new safe audio/voice style based on this reference when the provider supports it; otherwise describe the intended audio clearly in the video prompt.` : ""
  ].filter(Boolean);
  const visualDirection = [
    `Required uploaded reference usage for this ${mediaLabel}:`,
    ...lines,
    `All selected uploaded elements must appear in the final ${mediaLabel} unless physically impossible. Compose them so they look intentional, premium, and native to social media rather than pasted on.`,
    `Add appropriate stroke, outline, drop shadow, backing shape, spacing, or contrast treatment so the logo and uploaded photo/persona remain clearly distinguishable from the background.`,
    kind === "video"
      ? "For video, keep the logo visible for the opening or ending brand frame and include the product/persona reference in the main scene or B-roll. Maintain visual consistency across shots."
      : "For image, make the logo and product/persona references readable at mobile feed size. Use a clean layout with enough negative space and avoid covering the logo with text."
  ].join("\n");
  return [basePrompt, visualDirection, conversionDirection].filter(Boolean).join("\n\n");
}

function PlanEditorForm({ brief, draft, onSubmit, onCancel, submitLabel }: { brief?: Brief; draft?: PlanDraft; onSubmit: (form: FormData) => Promise<void>; onCancel: () => void; submitLabel: string }) {
  const source = brief || draft;
  const [format, setFormat] = useState(source?.format && contentFormatOptions.includes(source.format) ? source.format : "Short video 9:16");
  useEffect(() => {
    setFormat(source?.format && contentFormatOptions.includes(source.format) ? source.format : "Short video 9:16");
  }, [source?.format]);
  return (
    <form action={onSubmit} className="plan-edit">
      {brief && (
        <div className="plan-edit-head">
          <div>
            <div className="clbl">Editing content plan</div>
            <p>Review or change the fields used to create the final asset.</p>
          </div>
          <button type="button" onClick={onCancel}><ArrowLeft size={14} />Back to plans</button>
        </div>
      )}
      {brief && <input type="hidden" name="id" value={brief.id} />}
      <label>Topic<input name="topic" defaultValue={source?.topic || ""} required /></label>
      <label>Format<select name="format" value={format} onChange={(event) => setFormat(event.target.value)}>{contentFormatOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
      <label>Description<textarea name="description" defaultValue={source?.description || ""} /></label>
      <label>Video prompt<textarea name="videoPrompt" defaultValue={source?.videoPrompt || ""} /></label>
      {planContentKind(format) === "video" && <label>Duration (seconds)<input name="duration" type="number" min="1" step="1" defaultValue={source?.duration || defaultPlanDuration(format)} /></label>}
      <label>Hooks<textarea name="hooks" defaultValue={brief ? (brief.hooks || []).join("\n") : draft?.hooks || ""} /></label>
      <label>Outline<textarea name="outline" defaultValue={brief ? (brief.outline || []).join("\n") : draft?.outline || ""} /></label>
      <label>Shot list<textarea name="shotList" defaultValue={brief ? (brief.shotList || []).join("\n") : draft?.shotList || ""} /></label>
      <label>Creative notes<textarea name="creativeNotes" defaultValue={source?.creativeNotes || ""} /></label>
      <label>Caption<textarea name="caption" defaultValue={source?.caption || ""} /></label>
      <label>Hashtags<input name="hashtags" defaultValue={brief ? (brief.hashtags || []).join(", ") : draft?.hashtags || ""} /></label>
      <div className="grid two">
        <label>Optimal time<input name="optimalTime" defaultValue={source?.optimalTime || ""} /></label>
        <label>Expected performance<input name="expectedPerformance" defaultValue={source?.expectedPerformance || ""} /></label>
      </div>
      <div className="row-actions">
        <button className="primary" type="submit"><Check size={14} />{submitLabel}</button>
        <button type="button" onClick={onCancel}>{brief ? "Back to plans" : "Cancel"}</button>
      </div>
    </form>
  );
}

function BriefPanel({ data, run, setScreen, pendingPlan, setPendingGeneration }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<any>; setScreen: (screen: string) => void; pendingPlan: PendingPlan | null; setPendingGeneration: (generation: PendingGeneration | null) => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [generatingBrief, setGeneratingBrief] = useState<Brief | null>(null);
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [aiPromptOpen, setAiPromptOpen] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiDraft, setAiDraft] = useState<PlanDraft | null>(null);
  const [sourcePreview, setSourcePreview] = useState<SourceMediaPreview | null>(null);
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
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
    setAiDraft(null);
  };
  const closeCreate = () => {
    setCreatingPlan(false);
    setAiPromptOpen(false);
    setAiError("");
    setAiDraft(null);
  };
  const generateAiDraft = async (form: FormData) => {
    const idea = String(form.get("idea") || "").trim();
    if (!idea) {
      setAiError("Tell me what you want to create first.");
      return;
    }
    setAiError("");
    setAiGenerating(true);
    try {
      const draft = await post("generateBriefWithAi", { idea }) as PlanDraft;
      setAiDraft(draft);
      setAiPromptOpen(false);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "AI generation failed.");
    } finally {
      setAiGenerating(false);
    }
  };
  const generate = (brief: Brief) => setGeneratingBrief(brief);
  const sourceFromBrief = (brief: Brief): SourceMediaPreview | null => {
    if (!brief.sourceUrl && !brief.sourceThumbnailUrl && !brief.sourceMediaUrl) return null;
    return {
      title: brief.sourceTitle || brief.topic,
      platform: brief.sourcePlatform || brief.platforms[0],
      sourceUrl: brief.sourceUrl,
      thumbnailUrl: brief.sourceThumbnailUrl,
      mediaUrl: brief.sourceMediaUrl,
      mediaType: brief.sourceMediaType,
      description: brief.description
    };
  };
  const latestAssetForBrief = (brief: Brief) => [...data.assets]
    .filter((asset) => asset.briefId === brief.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  return (
    <div className="plan-page">
      {sourcePreview && <SourceMediaModal source={sourcePreview} onClose={() => setSourcePreview(null)} />}
      {previewAsset?.assetUrl && <AssetPreviewModal asset={previewAsset} onClose={() => setPreviewAsset(null)} />}
      {creatingPlan && (
        <div className="modal-backdrop">
          <div className="generation-modal">
            <div className="modal-head">
              <div>
                <h3>New content plan</h3>
                <p>Optional manual entry. Most plans can also be created from Research or filled with AI first.</p>
              </div>
              <div className="row-actions">
                <button className="primary" onClick={() => setAiPromptOpen(true)}><Sparkles size={14} />Fill fields with AI</button>
                <button onClick={closeCreate}>Close</button>
              </div>
            </div>
            {aiPromptOpen && (
              <div className="ai-plan-box">
                <form onSubmit={(event) => { event.preventDefault(); void generateAiDraft(new FormData(event.currentTarget)); }}>
                  <label>Tell me in a sentence or few, then I can create anything for you.
                    <textarea name="idea" placeholder="Example: Create an Instagram image post about why SME owners should automate invoice follow-ups." autoFocus />
                  </label>
                  {aiError && <div className="provider-error">{aiError}</div>}
                  <div className="row-actions">
                    <button className="primary" type="submit" disabled={aiGenerating}><Sparkles size={14} />{aiGenerating ? <AnimatedDots label="Generating" /> : "Fill fields"}</button>
                    <button type="button" onClick={() => setAiPromptOpen(false)} disabled={aiGenerating}>Cancel</button>
                  </div>
                </form>
              </div>
            )}
            <PlanEditorForm key={aiDraft ? JSON.stringify(aiDraft) : "blank"} draft={aiDraft || undefined} onSubmit={create} onCancel={closeCreate} submitLabel="Create plan" />
          </div>
        </div>
      )}
      {generatingBrief && (
        <GenerationModal
          brief={generatingBrief}
          onClose={() => setGeneratingBrief(null)}
          onStart={(generation) => {
            flushSync(() => {
              setPendingGeneration(generation);
              setGeneratingBrief(null);
              setScreen("publish");
            });
          }}
          onSubmit={async (payload) => {
            await run("generateDraftFromPlan", payload, "Generation queued in Publish");
            setPendingGeneration(null);
          }}
        />
      )}
      <section className="plan-hero">
        <div>
          <div className="clbl">Content Plan</div>
          <h2>Review and refine generated plans</h2>
          <p>Plans are editable briefs. Review the prompt, caption, hashtags, format, and notes, then create the final asset in Publish.</p>
        </div>
        <div className="plan-hero-actions">
          <div className="plan-count-pill">
            <strong>{plans.length}</strong>
            <span>Total saved plans</span>
          </div>
          <button onClick={() => setCreatingPlan(true)}><Plus size={14} />Manual plan</button>
        </div>
      </section>
      <div className="plan-list">
        {pendingPlan && (
          <article className="plan-card pending-plan">
            <div className="plan-index"><span /></div>
            <div className="plan-summary">
              <h3><AnimatedDots label="Generating content plan" /></h3>
              <p>{pendingPlan.title}</p>
              <small>{pendingPlan.description}</small>
              <div className="mini-progress"><span /></div>
            </div>
            <span className="status generating"><AnimatedDots label="Generating" /></span>
          </article>
        )}
        {plans.map((brief, index) => (
          <article className="plan-card" key={brief.id}>
            {editingId === brief.id ? (
              <PlanEditorForm brief={brief} onSubmit={save} onCancel={() => setEditingId(null)} submitLabel="Save" />
            ) : (
              <>
                {(() => {
                  const source = sourceFromBrief(brief);
                  const latestAsset = latestAssetForBrief(brief);
                  const hasGeneratedDraft = Boolean(latestAsset);
                  const canPreviewOutput = Boolean(latestAsset?.assetUrl);
                  return (
                <div className="plan-card-head compact">
                  <div className="plan-number">{index + 1}</div>
                  <div className="plan-summary-text">
                    <h3>{brief.topic}</h3>
                    <p>{brief.description || brief.hooks[0]}</p>
                  </div>
                  <div className="plan-type">{brief.format}</div>
                  <div className="plan-date">{brief.createdAt ? new Date(brief.createdAt).toLocaleString() : "No timestamp"}</div>
                  <div className="row-actions">
                    {source && <button type="button" onClick={() => setSourcePreview(source)}><Eye size={14} />Source</button>}
                    {canPreviewOutput && latestAsset && <button type="button" onClick={() => setPreviewAsset(latestAsset)}><Film size={14} />View output</button>}
                    {hasGeneratedDraft && !canPreviewOutput && <button type="button" onClick={() => setScreen("publish")}><RefreshCcw size={14} />In Publish</button>}
                    <button onClick={() => setEditingId(brief.id)}>Edit</button>
                    <button onClick={() => run("deleteBrief", { id: brief.id }, "Content plan deleted")}>Delete</button>
                    <button className="primary plan-create-button" onClick={() => generate(brief)}><Wand2 size={14} />{hasGeneratedDraft ? "Create again" : "Create asset"}</button>
                  </div>
                </div>
                  );
                })()}
              </>
            )}
          </article>
        ))}
        {plans.length === 0 && <div className="empty-state">No content plans yet. Create one from Research results, or use Manual plan when you already know the brief.</div>}
      </div>
    </div>
  );
}

function CreateContentModule({ initial, onSubmit, onCancel, onUsePlan, onStart, submitLabel = "Generate", busyLabel = "Sending to Publish", allowAiAssist = false }: { initial: CreateContentInitial; onSubmit: (payload: Record<string, unknown>) => Promise<void>; onCancel?: () => void; onUsePlan?: () => void; onStart?: (generation: PendingGeneration) => void; submitLabel?: string; busyLabel?: string; allowAiAssist?: boolean }) {
  const [activeInitial, setActiveInitial] = useState<CreateContentInitial>(initial);
  const [formVersion, setFormVersion] = useState(0);
  const [kind, setKind] = useState<GenerationKind>(initial.kind);
  const [model, setModel] = useState<string>(initial.model || generationModels[initial.kind][0][0]);
  const [duration, setDuration] = useState(closestDuration(initial.duration || 8, durationOptionsForModel(initial.model || generationModels[initial.kind][0][0])));
  const [platform, setPlatform] = useState<Platform>(initial.platform || defaultPlatformForKind(initial.kind));
  const [busy, setBusy] = useState(false);
  const [aiPromptOpen, setAiPromptOpen] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiIdea, setAiIdea] = useState("");
  const [assetRefs, setAssetRefs] = useState<AssetReference[]>([]);
  const assetRefsRef = useRef<AssetReference[]>([]);
  const durationOptions = durationOptionsForModel(model);
  const visualAssetsEnabled = kind === "video" || kind === "image";
  const resetFormFromInitial = (next: CreateContentInitial) => {
    const nextModel = next.model || generationModels[next.kind][0][0];
    setActiveInitial(next);
    setKind(next.kind);
    setModel(nextModel);
    setPlatform(next.platform || defaultPlatformForKind(next.kind));
    setDuration(closestDuration(next.duration || 8, durationOptionsForModel(nextModel)));
    setFormVersion((value) => value + 1);
  };
  useEffect(() => {
    assetRefsRef.current = assetRefs;
  }, [assetRefs]);
  useEffect(() => {
    resetFormFromInitial(initial);
  }, [initial.sourceLabel, initial.sourceTitle, initial.sourceDescription, initial.prompt, initial.caption, initial.hashtags, initial.kind, initial.model, initial.duration, initial.aspectRatio, initial.platform]);
  useEffect(() => {
    return () => {
      assetRefsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, []);
  const changeKind = (next: GenerationKind) => {
    const nextModel = generationModels[next][0][0];
    setKind(next);
    setModel(nextModel);
    setPlatform(defaultPlatformForKind(next));
    setDuration(closestDuration(activeInitial.duration || 8, durationOptionsForModel(nextModel)));
  };
  const changeModel = (next: string) => {
    setModel(next);
    setDuration(closestDuration(activeInitial.duration || duration || 8, durationOptionsForModel(next)));
  };
  const updateAssetRef = (role: AssetReference["role"], file?: File | null) => {
    setAssetRefs((current) => {
      const existing = current.find((item) => item.role === role);
      if (existing) URL.revokeObjectURL(existing.previewUrl);
      const rest = current.filter((item) => item.role !== role);
      return file?.name ? [...rest, { role, fileName: file.name, previewUrl: URL.createObjectURL(file), file }] : rest;
    });
  };
  const generateAiDraft = async () => {
    const idea = aiIdea.trim();
    if (!idea) {
      setAiError("Tell me what you want to create first.");
      return;
    }
    setAiError("");
    setAiGenerating(true);
    try {
      const draft = await post("generateBriefWithAi", {
        idea,
        requestedFormat: preferredFormatForKind(kind, activeInitial.aspectRatio),
        requestedDuration: kind === "video" ? duration : undefined,
        requestedModel: model
      }) as PlanDraft;
      resetFormFromInitial(createContentInitialFromDraft(draft));
      setAiPromptOpen(false);
      setAiIdea("");
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "AI generation failed.");
    } finally {
      setAiGenerating(false);
    }
  };
  const submit = async (form: FormData) => {
    setBusy(true);
    try {
      const selectedPlatform = String(form.get("platform") || platform || defaultPlatformForKind(kind));
      onStart?.({
        title: activeInitial.sourceTitle,
        description: visualAssetsEnabled && assetRefs.length ? "Uploading references and preparing provider generation." : "Preparing provider generation.",
        kind,
        model,
        startedAt: Date.now()
      });
      const cleanRefs = visualAssetsEnabled ? await uploadAssetReferences(assetRefs) : [];
      const promptWithDuration = withSelectedVideoDuration(String(form.get("prompt") || ""), kind, duration);
      const prompt = enrichPromptForSocialConversion(promptWithDuration, kind, cleanRefs);
      await onSubmit({
        platform: selectedPlatform,
        prompt,
        caption: String(form.get("caption") || ""),
        hashtags: String(form.get("hashtags") || ""),
        aspectRatio: String(form.get("aspectRatio") || ""),
        variants: String(form.get("variants") || ""),
        tone: String(form.get("tone") || ""),
        length: String(form.get("length") || ""),
        assetReferences: cleanRefs,
        generationType: kind,
        generationModel: model,
        duration: kind === "video" ? duration : undefined
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form key={formVersion} onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget)); }} className="generation-form create-generation-form">
      <section className="create-card">
        <div className="step-label"><span>1</span>Build the brief</div>
        <div className="brief-preview">
          <span>{activeInitial.sourceLabel}</span>
          <b>{activeInitial.sourceTitle}</b>
          <p>{activeInitial.sourceDescription}</p>
        </div>
        <div className="source-actions">
          {allowAiAssist && <button type="button" className="primary" onClick={() => setAiPromptOpen(true)} disabled={aiGenerating}><Sparkles size={14} />Fill fields with AI</button>}
          {onUsePlan && <button type="button" className="linkish secondary-plan-link" onClick={onUsePlan}>Load from Content Plan</button>}
        </div>
        <p className="step-helper">This step only prepares editable prompt, caption, and hashtags. It will not spend generation credits or create a video/image yet.</p>
        {aiPromptOpen && (
          <div className="ai-plan-box compact">
            <div className="ai-plan-inner">
              <label>Tell me in a sentence or few, then I will fill the fields below.
                <textarea name="idea" value={aiIdea} onChange={(event) => setAiIdea(event.target.value)} placeholder="Example: Create a 9:16 product demo video for busy SME founders about invoice follow-up automation." autoFocus />
              </label>
              {aiError && <div className="provider-error">{aiError}</div>}
              <div className="row-actions">
                <button className="primary" type="button" onClick={() => void generateAiDraft()} disabled={aiGenerating}><Sparkles size={14} />{aiGenerating ? <AnimatedDots label="Filling fields" /> : "Fill fields"}</button>
                <button type="button" onClick={() => setAiPromptOpen(false)} disabled={aiGenerating}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="create-card">
        <div className="step-label"><span>2</span>Choose format, model, and references</div>
        <div className="modal-grid">
          <label>Content type<select value={kind} onChange={(event) => changeKind(event.target.value as GenerationKind)}>
            <option value="video">Video</option>
            <option value="image">Image</option>
            <option value="text">Text post</option>
          </select></label>
          <label>Primary platform<select name="platform" value={platform} onChange={(event) => setPlatform(event.target.value as Platform)}>
            {platforms.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
            <option value="YouTube">YouTube</option>
          </select></label>
        </div>
        <div className="create-type-grid">
          <button type="button" className={kind === "video" ? "on" : ""} onClick={() => changeKind("video")}><b>Video</b><span>TikTok, Reels, Shorts</span></button>
          <button type="button" className={kind === "image" ? "on" : ""} onClick={() => changeKind("image")}><b>Image</b><span>Instagram, LinkedIn, Facebook</span></button>
          <button type="button" className={kind === "text" ? "on" : ""} onClick={() => changeKind("text")}><b>Text post</b><span>LinkedIn, X, Threads</span></button>
        </div>
        <div className="plat-row">
          {placementsForKind(kind).map((label) => <span className="pc on" key={label}><span className="pd" />{label}</span>)}
        </div>
      </section>

      <section className="create-card">
        <div className="clbl">Model - quality vs cost</div>
        <div className="model-options create-model-options">
          {generationModels[kind].map(([value, label, price]) => (
            <button type="button" key={value} className={model === value ? "on" : ""} onClick={() => changeModel(value)}>
              <span className="mcard-dot" />
              <b>{label}</b>
              <span>{price}</span>
            </button>
          ))}
        </div>
      </section>

      {visualAssetsEnabled && (
        <section className="create-card">
          <div className="clbl">Optional reference assets</div>
          <div className="upload-pair three">
            <AssetUploadBox icon={<Palette size={18} />} title="Product photo" helper="Optional visual reference" role="product photo" refs={assetRefs} onChange={updateAssetRef} />
            <AssetUploadBox icon={<UserRound size={18} />} title="Override avatar" helper="Optional persona reference" role="avatar/persona" refs={assetRefs} onChange={updateAssetRef} />
            <AssetUploadBox icon={<Sparkles size={18} />} title="Logo" helper="Optional brand mark" role="logo" refs={assetRefs} onChange={updateAssetRef} />
            {kind === "video" && <AssetUploadBox icon={<Mic size={18} />} title="Audio" helper="Optional audio reference" role="audio" refs={assetRefs} onChange={updateAssetRef} />}
          </div>
        </section>
      )}

      <section className="create-card">
        <div className="clbl">Generation settings</div>
        <div className="modal-grid">
          {kind === "video" && (
            <>
              <label>Duration (seconds)<select name="duration" value={duration} onChange={(event) => setDuration(event.target.value)}>{durationOptions.map((option) => <option key={option} value={option}>{option} seconds</option>)}</select></label>
              <label>Aspect ratio<select name="aspectRatio" defaultValue={activeInitial.aspectRatio === "16:9" ? "16:9" : "9:16"}><option value="9:16">9:16 vertical</option><option value="16:9">16:9 landscape</option></select></label>
            </>
          )}
          {kind === "image" && (
            <>
              <label>Image dimension<select name="aspectRatio" defaultValue={activeInitial.aspectRatio || "4:5"}><option value="1:1">1:1 square</option><option value="4:5">4:5 portrait</option><option value="16:9">16:9 landscape</option><option value="9:16">9:16 vertical</option></select></label>
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
      </section>

      <section className="create-card">
        <div className="step-label"><span>3</span>Review and generate final asset</div>
        <label>Generation prompt<textarea name="prompt" defaultValue={activeInitial.prompt} /></label>
        <label>Caption<textarea name="caption" defaultValue={activeInitial.caption} /></label>
        <label>Hashtags<input name="hashtags" defaultValue={activeInitial.hashtags} /></label>
        <div className="ftrow">
          <div>Selected: <b>{model}</b></div>
          <div className="row-actions">
            {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
            <button className="primary" disabled={busy}><Wand2 size={14} />{busy ? <AnimatedDots label={busyLabel} /> : submitLabel}</button>
          </div>
        </div>
      </section>
    </form>
  );
}

function AssetUploadBox({ icon, title, helper, role, refs, onChange }: { icon: ReactNode; title: string; helper: string; role: AssetReference["role"]; refs: AssetReference[]; onChange: (role: AssetReference["role"], file?: File | null) => void }) {
  const selected = refs.find((item) => item.role === role);
  const accept = role === "audio" ? "audio/*" : "image/*";
  return (
    <label className={`upbox ${selected ? "selected" : ""}`}>
      <input type="file" accept={accept} onChange={(event) => onChange(role, event.currentTarget.files?.[0])} />
      {selected && selected.file.type.startsWith("image/") ? <img className="upload-thumb" src={selected.previewUrl} alt={`${title} preview`} /> : icon}
      <b>{title}</b>
      <span>{selected?.fileName || helper}</span>
    </label>
  );
}

function GenerationModal({ brief, onClose, onStart, onSubmit }: { brief: Brief; onClose: () => void; onStart?: (generation: PendingGeneration) => void; onSubmit: (payload: Record<string, unknown>) => Promise<void> }) {
  const kind = planContentKind(brief.format);
  const initial: CreateContentInitial = {
    sourceLabel: "Content plan",
    sourceTitle: brief.topic,
    sourceDescription: brief.description || brief.hooks?.[0] || brief.format,
    kind,
    duration: brief.duration || defaultPlanDuration(brief.format) || 8,
    aspectRatio: defaultAspectRatioForFormat(brief.format),
    prompt: defaultGenerationPrompt(brief, kind),
    caption: defaultCaption(brief),
    hashtags: defaultHashtags(brief),
    platform: brief.platforms[0] || defaultPlatformForKind(kind)
  };
  return (
    <div className="modal-backdrop">
      <section className="generation-modal">
        <div className="modal-head">
          <div>
            <div className="clbl">Create final asset</div>
            <h3>{brief.topic}</h3>
            <p>Fields are prefilled from this content plan. Confirm them to send the asset to Publish.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>x</button>
        </div>
        <CreateContentModule initial={initial} onCancel={onClose} onStart={onStart} submitLabel="Create asset" onSubmit={(payload) => onSubmit({ ...payload, id: brief.id })} />
      </section>
    </div>
  );
}

function ResearchGenerateModal({ initial, run, onClose, setScreen, setPendingGeneration }: { initial: CreateContentInitial; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<any>; onClose: () => void; setScreen: (screen: string) => void; setPendingGeneration: (generation: PendingGeneration | null) => void }) {
  const [g01Review, setG01Review] = useState<{ videoPrompt: string; debugJson: string } | null>(null);
  const [pendingPayload, setPendingPayload] = useState<Record<string, unknown> | null>(null);
  const [generating, setGenerating] = useState(false);
  const queueGeneration = async (payload: Record<string, unknown>) => {
    flushSync(() => {
      setPendingGeneration({
        title: initial.sourceTitle,
        description: "Preparing provider generation from the selected research result.",
        kind: String(payload.generationType || initial.kind) as GenerationKind,
        model: String(payload.generationModel || initial.model || ""),
        startedAt: Date.now()
      });
      setScreen("publish");
    });
    onClose();
    await run("generateDirectContent", {
      ...payload,
      sourceResultId: initial.sourceResultId,
      sourceUrl: initial.sourceUrl,
      sourceTitle: initial.sourceTitle,
      sourceThumbnailUrl: initial.sourceThumbnailUrl,
      sourceMediaUrl: initial.sourceMediaUrl,
      sourceMediaType: initial.sourceMediaType
    }, "Generation queued in Publish");
    setPendingGeneration(null);
  };
  const prepareGeneration = async (payload: Record<string, unknown>) => {
    if (payload.generationType !== "video") {
      await queueGeneration(payload);
      return;
    }
    const result = await run("refineResearchVideoPrompt", {
      ...payload,
      sourceUrl: initial.sourceUrl,
      sourceTitle: initial.sourceTitle,
      sourceMediaUrl: initial.sourceMediaUrl,
      sourceMediaType: initial.sourceMediaType
    }, "Final video prompt prepared");
    const finalPrompt = String(result?.videoPrompt || "").trim();
    if (!finalPrompt) return;
    const debugJson = String(result?.debugJson || JSON.stringify({ videoPrompt: finalPrompt }, null, 2));
    setPendingPayload({ ...payload, prompt: finalPrompt });
    setG01Review({ videoPrompt: finalPrompt, debugJson });
  };
  const confirmDebugPrompt = async () => {
    if (!pendingPayload || generating) return;
    setGenerating(true);
    try {
      await queueGeneration(pendingPayload);
    } finally {
      setGenerating(false);
      setPendingPayload(null);
      setG01Review(null);
    }
  };
  return (
    <div className="modal-backdrop">
      <section className="generation-modal research-generate-modal">
        <div className="modal-head">
          <div>
            <div className="clbl">{g01Review ? "Debug pop up G01" : "Generate from research"}</div>
            <h3>{g01Review ? "Final video prompt JSON" : initial.sourceTitle}</h3>
            <p>{g01Review ? "This is the GPT-5.5 refined JSON. Generation starts only after OK." : "Review the prefilled fields, attach replacement logo/person/audio references if needed, then generate the final asset."}</p>
          </div>
          <button type="button" className="icon-btn" onClick={g01Review ? () => { setG01Review(null); setPendingPayload(null); } : onClose}>x</button>
        </div>
        {g01Review ? (
          <div className="g01-review">
            <label>G01 JSON<textarea readOnly value={g01Review.debugJson} /></label>
            <div className="ftrow">
              <div>{g01Review.videoPrompt.length} prompt characters</div>
              <div className="row-actions">
                <button type="button" onClick={() => { setG01Review(null); setPendingPayload(null); }} disabled={generating}>Cancel</button>
                <button type="button" className="primary" onClick={() => void confirmDebugPrompt()} disabled={generating}><Check size={14} />{generating ? <AnimatedDots label="Queuing" /> : "OK"}</button>
              </div>
            </div>
          </div>
        ) : (
          <CreateContentModule initial={initial} onCancel={onClose} submitLabel="Generate" busyLabel={initial.kind === "video" ? "Preparing G01" : "Sending to Publish"} onSubmit={prepareGeneration} />
        )}
      </section>
    </div>
  );
}

function CreateContentPanel({ data, run, setScreen, setPendingGeneration }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<void>; setScreen: (screen: string) => void; setPendingGeneration: (generation: PendingGeneration | null) => void }) {
  const context = data.workspace.niche?.trim() || "your brand";
  const defaultInitial: CreateContentInitial = {
    sourceLabel: "Direct generation",
    sourceTitle: "Generate from scratch",
    sourceDescription: "Use this to create a new asset directly. All outputs are sent to Publish after generation starts.",
    kind: "video",
    duration: 8,
    aspectRatio: "9:16",
    prompt: `Create a founder-led social asset for ${context}. Use a practical hook, concrete example, clean pacing or layout, and a clear CTA.`,
    caption: `A practical reminder for ${context}: make the message specific, useful, and easy to act on.`,
    hashtags: "#ContentStrategy, #SocialMedia, #Creator",
    platform: "TikTok"
  };
  const initial = defaultInitial;
  return (
    <div className="create-page">
      <div className="create-top">
        <div>
          <div className="module-kicker">Module 4</div>
          <h2>Create content</h2>
        </div>
        <div className="credit-pill">Generated assets move to <b>Publish</b></div>
      </div>
      <CreateContentModule
        initial={initial}
        allowAiAssist
        onStart={(generation) => {
          flushSync(() => {
            setPendingGeneration(generation);
            setScreen("publish");
          });
        }}
        onSubmit={async (payload) => {
          await run("generateDirectContent", {
            ...payload,
            sourceResultId: initial.sourceResultId,
            sourceUrl: initial.sourceUrl,
            sourceTitle: initial.sourceTitle,
            sourceThumbnailUrl: initial.sourceThumbnailUrl,
            sourceMediaUrl: initial.sourceMediaUrl,
            sourceMediaType: initial.sourceMediaType
          }, "Generation queued in Publish");
          setPendingGeneration(null);
        }}
      />
    </div>
  );
}

function PublishPanel({ data, run, pendingGeneration }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<void>; pendingGeneration: PendingGeneration | null }) {
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [sourcePreview, setSourcePreview] = useState<SourceMediaPreview | null>(null);
  const [generationNotice, setGenerationNotice] = useState("");
  const notifiedRef = useRef<Set<string>>(new Set());
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  }, [run]);
  const queue = [...data.publishQueue].sort((a, b) => new Date(b.createdAt || b.scheduledAt).getTime() - new Date(a.createdAt || a.scheduledAt).getTime());
  const startIds = queue
    .map((item) => {
      const asset = data.assets.find((entry) => entry.id === item.assetId);
      return item.status === "generating" && asset?.provider === "kie" && !asset.providerTaskId ? asset.id : "";
    })
    .filter(Boolean)
    .join(",");
  const pollIds = queue
    .map((item) => {
      const asset = data.assets.find((entry) => entry.id === item.assetId);
      return item.status === "generating" && asset?.providerTaskId ? asset.id : "";
    })
    .filter(Boolean)
    .join(",");
  useEffect(() => {
    const ids = startIds.split(",").filter(Boolean);
    if (ids.length === 0) return;
    ids.forEach((id) => runRef.current("startAssetGeneration", { id }, ""));
  }, [startIds]);
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
  useEffect(() => {
    queue.forEach((item) => {
      if (!["done", "failed"].includes(item.status) || notifiedRef.current.has(item.id)) return;
      const createdAt = new Date(item.createdAt || item.scheduledAt).getTime();
      if (Date.now() - createdAt > 1000 * 60 * 60) {
        notifiedRef.current.add(item.id);
        return;
      }
      notifiedRef.current.add(item.id);
      setGenerationNotice(item.status === "done" ? `${item.title} is ready in Publish.` : `${item.title} failed. Open Logs for the provider error.`);
    });
    if (!generationNotice) return;
    const timer = window.setTimeout(() => setGenerationNotice(""), 7000);
    return () => window.clearTimeout(timer);
  }, [queue, generationNotice]);
  return (
    <div className="publish-page">
      {sourcePreview && <SourceMediaModal source={sourcePreview} onClose={() => setSourcePreview(null)} />}
      {previewAsset?.assetUrl && <AssetPreviewModal asset={previewAsset} onClose={() => setPreviewAsset(null)} />}
      <section className="plan-hero">
        <div>
          <div className="clbl">My Contents</div>
          <h2>Generated drafts and content queue</h2>
          <p>Generated content appears here first, then moves to Upload-Post once it is done.</p>
        </div>
        <Metric label="Done drafts" value={queue.filter((item) => item.status === "done").length} />
      </section>
      {generationNotice && <div className="generation-notice">{generationNotice}</div>}
      <div className="publish-list">
        {pendingGeneration && (
          <article className="publish-card with-video pending-publish-card">
            <div className="image-thumb pending">
              {pendingGeneration.kind === "video" ? <Film size={22} /> : pendingGeneration.kind === "image" ? <Palette size={22} /> : <FileText size={22} />}
              <span><AnimatedDots label="Preparing generation" /></span>
            </div>
            <div className="publish-main">
              <div className="publish-icon">{pendingGeneration.kind === "video" ? <Film size={18} /> : pendingGeneration.kind === "image" ? <Palette size={18} /> : <FileText size={18} />}</div>
              <div>
                <h3>{pendingGeneration.title}</h3>
                <p>{pendingGeneration.description}</p>
                <div className="publish-tags">
                  <span>{pendingGeneration.kind}</span>
                  <span>{pendingGeneration.model}</span>
                  <span>{new Date(pendingGeneration.startedAt).toLocaleString()}</span>
                </div>
                <small className="generation-help">You can leave this page. Generation continues in the background and this row updates automatically.</small>
              </div>
            </div>
            <div className="publish-actions">
              <span className="status generating"><AnimatedDots label="Generating" /></span>
              <span className="auto-poll"><RefreshCcw size={13} /><AnimatedDots label="Preparing" /></span>
            </div>
          </article>
        )}
        {queue.map((item) => {
          const asset = data.assets.find((entry) => entry.id === item.assetId);
          const isVideo = item.generationType === "video" || asset?.type === "video" || asset?.type === "ugc";
          const isImage = item.generationType === "image" || asset?.type === "image" || asset?.type === "carousel";
          const videoUrl = isVideo ? item.assetUrl || asset?.assetUrl : "";
          const imageUrl = isImage ? item.assetUrl || asset?.assetUrl : "";
          const sourceMedia: SourceMediaPreview | null = item.sourceUrl || item.sourceThumbnailUrl || item.sourceMediaUrl || asset?.sourceUrl || asset?.sourceThumbnailUrl || asset?.sourceMediaUrl
            ? {
              title: item.sourceTitle || asset?.sourceTitle || item.title,
              platform: item.platform,
              sourceUrl: item.sourceUrl || asset?.sourceUrl,
              thumbnailUrl: item.sourceThumbnailUrl || asset?.sourceThumbnailUrl,
              mediaUrl: item.sourceMediaUrl || asset?.sourceMediaUrl,
              mediaType: item.sourceMediaType || asset?.sourceMediaType,
              description: item.caption || asset?.prompt
            }
            : null;
          const startingProvider = item.status === "generating" && asset?.provider === "kie" && !asset.providerTaskId;
          return (
            <article className={`publish-card ${isVideo || isImage ? "with-video" : ""}`} key={item.id}>
              {isVideo && (
                <button className={`video-thumb ${videoUrl ? "" : "pending"}`} type="button" disabled={!videoUrl} onClick={() => asset?.assetUrl && setPreviewAsset(asset)}>
                  {videoUrl ? <video src={videoUrl} muted preload="metadata" playsInline /> : <Film size={22} />}
                  <span>{videoUrl ? "Preview video" : <AnimatedDots label="Generating video" />}</span>
                </button>
              )}
              {!isVideo && isImage && (
                <button className={`image-thumb ${imageUrl ? "" : "pending"}`} type="button" disabled={!imageUrl} onClick={() => asset && imageUrl && setPreviewAsset({ ...asset, assetUrl: imageUrl, type: "image" })}>
                  {imageUrl ? <img src={imageUrl} alt={`${item.title} generated preview`} /> : <Palette size={22} />}
                  <span>{imageUrl ? "Preview image" : item.status === "failed" ? "No image generated" : <AnimatedDots label="Generating image" />}</span>
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
                  {item.status === "generating" && <small className="generation-help">Provider generation is running. You can switch tabs; Publish will keep polling automatically.</small>}
                  {sourceMedia && <button type="button" className="asset-link asset-button-link" onClick={() => setSourcePreview(sourceMedia)}><Eye size={14} />View source media</button>}
                  {videoUrl && <div className="asset-actions"><button type="button" onClick={() => asset && setPreviewAsset(asset)}><Film size={14} />Play video</button><a className="asset-link" href={`/api/assets/${asset?.id}/download`}>Download MP4</a></div>}
                  {!isVideo && imageUrl && asset && <button type="button" className="asset-link asset-button-link" onClick={() => setPreviewAsset({ ...asset, assetUrl: imageUrl, type: "image" })}>Preview image</button>}
                  {item.error && <span className="provider-error inline">{item.error}</span>}
                </div>
              </div>
              <div className="publish-actions">
                <span className={`status ${item.status}`}>{item.status === "done" ? "Done" : item.status}</span>
                {item.status === "generating" && <span className="auto-poll"><RefreshCcw size={13} /><AnimatedDots label={startingProvider ? "Starting provider" : "Auto-checking"} /></span>}
              </div>
            </article>
          );
        })}
        {queue.length === 0 && !pendingGeneration && <div className="empty-state">No generated drafts yet. Use Research or Create Content to create the first item.</div>}
      </div>
    </div>
  );
}

function SourceMediaModal({ source, onClose }: { source: SourceMediaPreview; onClose: () => void }) {
  const playable = source.mediaUrl || "";
  const isVideo = source.mediaType === "video" || /\.(mp4|webm|mov|m3u8)(\?|$)/i.test(playable);
  const isImage = source.mediaType === "image" || /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(playable);
  const imageUrl = isImage ? playable : source.thumbnailUrl;
  const displayImageUrl = proxiedMediaUrl(imageUrl);
  return (
    <div className="modal-backdrop video-backdrop">
      <section className="video-player-modal source-media-modal">
        <div className="modal-head">
          <div>
            <div className="clbl">Source Media</div>
            <h3>{source.title}</h3>
            <p>{source.platform || "Research source"}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>x</button>
        </div>
        {playable && isVideo ? (
          <video src={playable} controls autoPlay playsInline />
        ) : displayImageUrl ? (
          <img className="asset-preview-image" src={displayImageUrl} alt={`${source.title} source preview`} />
        ) : (
          <div className="source-media-empty">
            <Film size={28} />
            <b>No direct media file returned by the source actor</b>
            <span>The original post can still be opened for comparison.</span>
          </div>
        )}
        {source.description && <p className="source-media-description">{source.description}</p>}
        <div className="modal-actions">
          {source.sourceUrl && <a className="asset-link" href={source.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open original post</a>}
          {playable && <a className="asset-link" href={playable} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open media file</a>}
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}

function AssetPreviewModal({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const isImage = asset.type === "image" || asset.type === "carousel";
  const downloadLabel = isImage ? "Download image" : "Download MP4";
  return (
    <div className="modal-backdrop video-backdrop">
      <section className="video-player-modal">
        <div className="modal-head">
          <div>
            <div className="clbl">{isImage ? "Image Preview" : "Video Preview"}</div>
            <h3>{asset.title}</h3>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>x</button>
        </div>
        {isImage ? <img className="asset-preview-image" src={asset.assetUrl} alt={`${asset.title} generated preview`} /> : <video src={asset.assetUrl} controls autoPlay playsInline />}
        <div className="modal-actions">
          <a className="asset-link" href={`/api/assets/${asset.id}/download`}>{downloadLabel}</a>
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}
function AnalyticsPanel({ data }: { data: AppData }) {
  return <div className="grid three"><Metric label="Engagement forecast" value="4.8%" /><Metric label="Published posts" value={data.publishQueue.filter((p) => p.status === "published").length} /><Metric label="Avg gap score" value={Math.round(data.opportunities.reduce((sum, item) => sum + item.gapScore, 0) / Math.max(1, data.opportunities.length))} /><PanelCard title="Feedback loop"><p>Published assets retain their originating brief, template, platform, and score so future recommendations can learn from performance results.</p></PanelCard></div>;
}

function LogPanel({ data }: { data: AppData }) {
  const [provider, setProvider] = useState("all");
  const [status, setStatus] = useState("all");
  const providers = Array.from(new Set((data.debugLogs || []).map((item) => item.provider).filter(Boolean))) as string[];
  const logs = (data.debugLogs || []).filter((item) => (provider === "all" || item.provider === provider) && (status === "all" || item.status === status));
  return (
    <div className="log-page">
      <section className="log-hero">
        <div>
          <div className="clbl">Debug log</div>
          <h2>Actions, prompts, and provider calls</h2>
          <p>Audit what happened, which prompt was sent, and what provider task or error came back.</p>
        </div>
        <div className="log-filters">
          <label>Provider<select value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="all">All providers</option>
            {providers.map((item) => <option key={item} value={item}>{item}</option>)}
          </select></label>
          <label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="started">Started</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="info">Info</option>
          </select></label>
        </div>
      </section>
      <div className="log-list">
        {logs.map((item) => (
          <article className="log-row" key={item.id}>
            <div className={`log-status ${item.status}`} />
            <div className="log-main">
              <div className="log-head">
                <div>
                  <b>{item.label}</b>
                  <span>{item.action}{item.provider ? ` - ${item.provider}` : ""}</span>
                </div>
                <time>{new Date(item.createdAt).toLocaleString()}</time>
              </div>
              {item.error && <div className="provider-error inline">{item.error}</div>}
              {item.prompt && (
                <details className="log-details">
                  <summary>Prompt sent</summary>
                  <pre>{item.prompt}</pre>
                </details>
              )}
              {item.details && Object.keys(item.details).length > 0 && (
                <details className="log-details">
                  <summary>Payload / result details</summary>
                  <pre>{JSON.stringify(item.details, null, 2)}</pre>
                </details>
              )}
            </div>
          </article>
        ))}
        {logs.length === 0 && <div className="empty-state">No logs match the selected filters.</div>}
      </div>
      <PanelCard title="Recent activity">
        {data.activity.map((item) => <div className="activity-row" key={item.id}><Check size={14} />{item.message}</div>)}
      </PanelCard>
    </div>
  );
}

function AutomationPanel({ data, run }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<void> }) {
  return (
    <div className="mock-wrap">
      <PanelCard title="Automation workflows">
        <div className="auto-row">
          <div><b>Weekly research refresh</b><span>Apify trend scan, competitor scoring, content generation queue</span></div>
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

function PromptAdminCard({ data, run }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<void> }) {
  return (
    <PanelCard title="Prompt admin">
      <form className="brand-form prompt-admin-form" action={(form) => run("updatePromptTemplates", Object.fromEntries(form.entries()), "Prompt templates saved")}>
        <div className="modal-grid">
          <label>Username<input name="adminUsername" defaultValue="admin" autoComplete="username" /></label>
          <label>Password<input name="adminPassword" type="password" defaultValue="admin" autoComplete="current-password" /></label>
        </div>
        <p className="muted">These templates power Research result to Generate Content. The video flow stays two-stage internally because Step 2 runs after the user edits the modal fields and uploads logo/person/audio references.</p>
        <section className="prompt-module">
          <div className="prompt-module-head">
            <div>
              <b>Research Video Prompt</b>
              <span>One video prompt configuration, executed in two steps.</span>
            </div>
          </div>
          <label><span className="prompt-step">Step 1 - Source to editable prompt</span><textarea name="researchVideoRecreate" defaultValue={data.promptTemplates.researchVideoRecreate} /></label>
          <p className="muted compact">Variables: <code>{"{{sourceMediaUrl}}"}</code>, <code>{"{{sourceUrl}}"}</code>, <code>{"{{sourceTitle}}"}</code>, <code>{"{{sourceDescription}}"}</code>, <code>{"{{durationLine}}"}</code>, <code>{"{{assetInstruction}}"}</code>.</p>
          <label><span className="prompt-step">Step 2 - Edited prompt to final G01 JSON</span><textarea name="researchVideoPromptRefine" defaultValue={data.promptTemplates.researchVideoPromptRefine} /></label>
          <p className="muted compact">Variable: <code>{"{{prompt}}"}</code>. This step controls the final GPT-5.5 instruction, including uploaded logo/person/audio replacement rules.</p>
        </section>
        <section className="prompt-module">
          <div className="prompt-module-head">
            <div>
              <b>Research Image Prompt</b>
              <span>Source image or carousel result to editable image-generation prompt.</span>
            </div>
          </div>
          <label><span className="prompt-step">Step 1 - Source to editable image prompt</span><textarea name="researchImageRecreate" defaultValue={data.promptTemplates.researchImageRecreate} /></label>
          <p className="muted compact">Variables: <code>{"{{sourceMediaUrl}}"}</code>, <code>{"{{sourceUrl}}"}</code>, <code>{"{{sourceTitle}}"}</code>, <code>{"{{sourceDescription}}"}</code>, <code>{"{{assetInstruction}}"}</code>. Uploaded logo/person/product reference instructions are added later by the shared Create Content module.</p>
        </section>
        <section className="prompt-module">
          <div className="prompt-module-head">
            <div>
              <b>Research Text Prompt</b>
              <span>Source text/link result to editable text-post prompt.</span>
            </div>
          </div>
          <label><span className="prompt-step">Step 1 - Source to editable text prompt</span><textarea name="researchTextRecreate" defaultValue={data.promptTemplates.researchTextRecreate} /></label>
          <p className="muted compact">Variables: <code>{"{{sourceUrl}}"}</code>, <code>{"{{sourceTitle}}"}</code>, <code>{"{{sourceDescription}}"}</code>. Text generation does not use logo/person/audio attachments.</p>
        </section>
        <button className="primary"><Settings size={14} />Save prompt templates</button>
      </form>
    </PanelCard>
  );
}

function AdminPanel({ data, run, integrations }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<void>; integrations: IntegrationData | null }) {
  return (
    <div className="admin-page">
      <section className="plan-hero">
        <div>
          <div className="clbl">Backend</div>
          <h2>Backend controls</h2>
          <p>Edit generation prompt templates and inspect runtime provider status. Admin template changes are saved to the same cloud data store used by the app.</p>
        </div>
        <div className="plan-count-pill"><strong>admin</strong><span>Default login</span></div>
      </section>
      <div className="grid two">
        <PromptAdminCard data={data} run={run} />
        <PanelCard title="Provider status">
          <div className="provider-list">{Object.entries(integrations || {}).map(([name, value]) => <div className="provider-row" key={name}><b>{name}</b><span className={value.ok || value.configured ? "good" : "bad"}>{value.ok ? "verified" : value.configured ? "configured" : "missing"}</span>{value.status && <small>HTTP {value.status}</small>}{value.error && <small>{value.error}</small>}</div>)}</div>
        </PanelCard>
        <PanelCard title="Backend credentials">
          <p className="muted">Prompt admin uses the requested default credentials. Change these before production.</p>
          <code>username: admin</code>
          <code>password: admin</code>
        </PanelCard>
        <PanelCard title="Cloud backend">
          <p>Current production backend is served by the same Cloud Run service as the frontend.</p>
          <code>https://contentagent-social-mkhae4sjlq-as.a.run.app/api</code>
        </PanelCard>
      </div>
    </div>
  );
}

function SettingsPanel({ data, run, integrations }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<void>; integrations: IntegrationData | null }) {
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
  return (
    <div className="grid two">
      <PanelCard title="Workspace context">
        <form className="brand-form" action={(form) => run("updateWorkspace", Object.fromEntries(form.entries()), "Workspace context saved")}>
          <label>Workspace name<input name="name" defaultValue={data.workspace.name} /></label>
          <label>Brand / niche<textarea name="niche" defaultValue={data.workspace.niche} /></label>
          <p className="muted">This Brand / niche value is passed into AI content-plan generation as context.</p>
          <button className="primary">Save workspace context</button>
        </form>
      </PanelCard>
      <PromptAdminCard data={data} run={run} />
      <PanelCard title="Provider status">
        <div className="provider-list">{Object.entries(integrations || {}).map(([name, value]) => <div className="provider-row" key={name}><b>{name}</b><span className={value.ok || value.configured ? "good" : "bad"}>{value.ok ? "verified" : value.configured ? "configured" : "missing"}</span>{value.status && <small>HTTP {value.status}</small>}{value.error && <small>{value.error}</small>}</div>)}</div>
      </PanelCard>
      <PanelCard title="Connect social accounts">
        <p className="muted">Demo is configured to Upload-Post profile Mariana and publishes to TikTok, Facebook, and X. Use this only if you need to re-open the connection page.</p>
        <button className="primary" onClick={createConnectUrl}><Megaphone size={14} />Open Mariana connect link</button>
        {connectUrl && <p className="muted">Connection page opened in a new tab.</p>}
        {connectError && <p className="provider-error">{connectError}</p>}
      </PanelCard>
      <PanelCard title="Token handling"><p>Keys are loaded from ignored local environment variables. Rotate the pasted keys before production because they were exposed in chat.</p><code>KIE_API_TOKEN, APIFY_API_TOKEN, UPLOAD_POST_API_KEY</code></PanelCard>
      <PanelCard title="Recommended production shape"><p>GCP Cloud Run or a VPS can run this app later. Keep Postgres, queue, object storage, and provider keys outside the client.</p></PanelCard>
    </div>
  );
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
