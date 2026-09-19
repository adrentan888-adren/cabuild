"use client";
import StatusToast, { useStatusToast } from "@/components/status-toast";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { flushSync } from "react-dom";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  BarChart3,
  Bug,
  CalendarDays,
  Check,
  Pencil,
  ExternalLink,
  Eye,
  FileText,
  Film,
  Mic,
  Lightbulb,
  Megaphone,
  Palette,
  Info,
  Plus,
  Radar,
  RefreshCcw,
  Search,
  Settings,
  Sparkles,
  UserRound,
  Wand2
} from "lucide-react";
import PageIntro from "@/components/page-intro";
import ContentDialog from "@/components/content-dialog";
import ChoiceButtons from "@/components/choice-buttons";
import ContentInfo from "@/components/content-info";
import ContentOutputCard from "@/components/content-output-card";
import PersonaPreview from "@/components/persona-preview";
import { browserHistoryIndex, useLeaveWarning } from "@/lib/use-leave-warning";
import { subscribeHistoryGuard } from "@/components/history-guard";
import { notifyCreditUsage } from "@/lib/credit-refresh";
import { contentCreatorQueue } from "@/lib/content-origin";
import GlobalHeader from "@/components/global-header";
import WelcomeHome from "@/components/welcome-home";
import WorkspaceRail from "@/components/workspace-rail";
import type { Asset, AutomationJob, AutomationRule, AutomationSourceRun, AutomationSourceWatcher, BrandKit, Brief, Competitor, CompetitorResult, Opportunity, Platform, PromptTemplates, PublishItem, SocialAudit, Workspace } from "@/lib/types";
import type { PersonaMediaAsset, PersonaProfile } from "@/lib/types";
import { appendPersonaContext, buildPersonaContext } from "@/lib/persona";

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
  automationRules: AutomationRule[];
  automationJobs: AutomationJob[];
  automationSourceWatchers: AutomationSourceWatcher[];
  automationSourceRuns: AutomationSourceRun[];
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

function createInitialFromResearchResult(item: CompetitorResult, templates: PromptTemplates, persona?: PersonaProfile): CreateContentInitial {
  const kind = researchResultKind(item);
  const sourceMediaUrl = item.mediaUrl || item.thumbnailUrl || item.url;
  const model = kind === "image" ? "gpt-image-2" : kind === "text" ? "gemini-3.5-flash" : "veo-fast";
  const duration = kind === "video" ? closestDuration(item.duration || 8, durationOptionsForModel(model)) : undefined;
  const template = kind === "image" ? templates.researchImageRecreate : kind === "text" ? templates.researchTextRecreate : templates.researchVideoRecreate;
  const personaContext = buildPersonaContext(persona);
  const renderedPersonaContext = personaContext ? `Persona context:\n${personaContext}` : "";
  const basePrompt = kind === "text"
    ? renderTemplate(template, {
      sourceMediaUrl,
      sourceUrl: item.url,
      sourceTitle: item.title,
      sourceDescription: item.description || "",
      durationLine: "",
      assetInstruction: "",
      personaContext: renderedPersonaContext
    })
    : renderTemplate(template, {
      sourceMediaUrl,
      sourceUrl: item.url,
      sourceTitle: item.title,
      sourceDescription: item.description || "",
      durationLine: kind === "video" && duration ? `the video duration is supposed to be ${duration}s` : "",
      assetInstruction: researchAssetInstruction(kind),
      personaContext: renderedPersonaContext
    });
  const prompt = withSelectedVideoDuration(appendPersonaContext(basePrompt, personaContext), kind, duration);
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
  const chargeable = /generate|refine|autoFill|startAsset/i.test(action) || ["scanResearchUrl", "scanKeywordResearch", "runAutomationNow", "runSourceWatcherNow"].includes(action);
  try {
  const res = await fetch("/api/social", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload })
  });
  if (!res.ok) throw new Error((await res.json()).error || "Request failed");
  const result = await res.json();
  if (action === "pollAsset" && ["ready", "failed", "done"].includes(result?.status)) notifyCreditUsage();
  return result;
  } finally { if (chargeable) notifyCreditUsage(); }
}

export default function Home() {
  const router = useRouter();
  const [data, setData] = useState<AppData | null>(null);
  const [screen, setScreen] = useState("home");
  const { toast, setToast } = useStatusToast();
  const [integrations, setIntegrations] = useState<IntegrationData | null>(null);
  const [pendingGeneration, setPendingGeneration] = useState<PendingGeneration | null>(null);
  const [directCreateInitial, setDirectCreateInitial] = useState<CreateContentInitial | null>(null);
  const [loading, setLoading] = useState(true);
  const [personaEditing, setPersonaEditing] = useState(false);
  const confirmLeave = useLeaveWarning(personaEditing);
  const historyIndex = useRef(0);
  const restoringHistory = useRef(false);

  const navigateScreen = useCallback((nextScreen: string) => {
    const nextUrl = nextScreen === "home" ? "/" : `/?view=${encodeURIComponent(nextScreen)}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextUrl) {
      if (!confirmLeave()) return;
      window.history.pushState({ ...window.history.state, creatorIndex: ++historyIndex.current }, "", nextUrl);
    }
    setScreen(nextScreen);
    document.querySelector<HTMLElement>(".main")?.scrollTo({ top: 0, behavior: "auto" });
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [confirmLeave]);

  async function refresh() {
    const res = await fetch("/api/app", { cache: "no-store" });
    if (res.status === 401) {
      setData(null);
      setLoading(false);
      router.replace("/login");
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
    const requestedView = new URLSearchParams(window.location.search).get("view");
    const normalViews = new Set(["audit", "persona", "research", "create", "publish", "automation", "analyse", "logs", "settings", "account"]);
    historyIndex.current = browserHistoryIndex() ?? window.history.state?.creatorIndex ?? 0;
    window.history.replaceState({ ...window.history.state, creatorIndex: historyIndex.current }, "");
    const syncView = (event: PopStateEvent) => {
      const nextIndex = browserHistoryIndex() ?? event.state?.creatorIndex ?? historyIndex.current - 1;
      if (restoringHistory.current && nextIndex === historyIndex.current) {
        restoringHistory.current = false;
        // The router never left this entry. Do not restore its older cached tree.
        event.stopImmediatePropagation();
        return;
      }
      restoringHistory.current = false;
      if (!confirmLeave()) {
        // Keep Next's router from unmounting this editor before history is restored.
        event.stopImmediatePropagation();
        restoringHistory.current = true;
        window.history.go(historyIndex.current - nextIndex || 1);
        return;
      }
      historyIndex.current = nextIndex;
      const view = new URLSearchParams(window.location.search).get("view");
      setScreen(view && normalViews.has(view) ? view : "home");
    };
    if (requestedView && normalViews.has(requestedView)) setScreen(requestedView);
    return subscribeHistoryGuard(syncView);
  }, [confirmLeave]);

  useEffect(() => {
    if (!pendingGeneration || !data?.publishQueue.length) return;
    const pendingStartedAt = pendingGeneration.startedAt - 30000;
    const hasNewQueueItem = contentCreatorQueue(data.publishQueue, data.assets).some((item) => new Date(item.createdAt || item.scheduledAt).getTime() >= pendingStartedAt);
    if (hasNewQueueItem) setPendingGeneration(null);
  }, [data?.publishQueue, data?.assets, pendingGeneration]);

  async function run(action: string, payload: Record<string, unknown> = {}, message = "Updated") {
    try {
      const result = await post(action, payload);
      await refresh();
      setToast(message);
      return result;
    } catch (error) {
      await refresh();
      setToast(error instanceof Error ? error.message : "Action failed", "error");
      return null;
    }
  }

  if (loading) return <div className="loading">Loading ContentAgent Social...</div>;

  if (!data) return <div className="loading">Redirecting to sign in...</div>;

  return (
    <div className={`app-shell ${screen === "home" ? "home-shell" : "workspace-shell"}`}>
      <StatusToast toast={toast} onDismiss={() => setToast(null)} />
      <main className="main">
        <header className="topbar">
          <GlobalHeader
            activeMode={screen === "home" || screen === "account" || screen === "settings" ? null : "normal"}
            activePage={screen === "create" ? "publish" : screen}
            initialAccount={data.user}
            initialWorkspaceCredits={data.workspace.credits}
            onBeforeLeave={confirmLeave}
            onHomeNavigate={() => navigateScreen("home")}
            onNormalNavigate={navigateScreen}
          />

        </header>

        {screen === "home" ? (
          <section className="panel active">
            <HomePanel data={data} setScreen={navigateScreen} openDrama={() => router.push("/drama-studio?step=1")} />
          </section>
        ) : (
          <div className="workspace-content-frame normal-workspace-frame">
            {screen !== "account" && screen !== "settings" && <WorkspaceRail mode="normal" activePage={screen === "create" ? "publish" : screen} onNormalNavigate={navigateScreen} />}
            <section className="panel active">
              {screen === "research" && directCreateInitial && (
                <ResearchInlineEditor key={directCreateInitial.sourceResultId || directCreateInitial.sourceTitle} initial={directCreateInitial} persona={data.personaProfile} personaAssets={data.personaProfile.mediaAssets || []} run={run} onClose={() => setDirectCreateInitial(null)} setScreen={navigateScreen} setPendingGeneration={setPendingGeneration} />
              )}
              {screen === "audit" && <SocialAuditPanel data={data} run={run} />}
              {screen === "persona" && <PersonaPanel data={data} run={run} onEditingChange={setPersonaEditing} />}
              {screen === "research" && <IntelligencePanel data={data} run={run} refresh={refresh} setDirectCreateInitial={(initial) => { setDirectCreateInitial(initial); window.setTimeout(() => document.getElementById("research-inline-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); }} />}
              {(screen === "create" || screen === "publish") && <PublishPanel data={data} run={run} pendingGeneration={pendingGeneration} onCreate={() => navigateScreen("create")} onLibrary={() => navigateScreen("publish")} composer={screen === "create" ? <CreateContentPanel data={data} run={run} setScreen={navigateScreen} setPendingGeneration={setPendingGeneration} /> : undefined} />}
              {screen === "drama" && <DramaWorkspacePanel src="/drama-studio" title="Drama Studio" refresh={refresh} />}
              {screen === "asset-library" && <DramaWorkspacePanel src="/drama-studio/assets" title="Asset Library" refresh={refresh} />}
              {screen === "automation" && <AutomationPanel data={data} run={run} />}
              {screen === "analyse" && <AnalyticsPanel data={data} />}
              {screen === "logs" && <LogPanel data={data} />}
              {screen === "account" && <AccountPanel data={data} />}
              {screen === "settings" && <SettingsPanel data={data} run={run} integrations={integrations} />}
            </section>
            <span className="workspace-rail-balance" aria-hidden="true" />
          </div>
        )}
      </main>

    </div>
  );
}



function AnimatedDots({ label }: { label: string }) {
  const [count, setCount] = useState(1);
  useEffect(() => {
    const timer = window.setInterval(() => setCount((value) => value % 3 + 1), 420);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="animated-dots">{label}<span className="dot-slot">{".".repeat(count)}</span></span>;
}

function HomePanel({ data, setScreen, openDrama }: { data: AppData; setScreen: (s: string) => void; openDrama: () => void }) {
  return <WelcomeHome data={data} onNavigate={setScreen} onDrama={openDrama} />;
}

function HealthMetric({ tone, value, label, sub }: { tone: "blue" | "green" | "amber" | "purple"; value: string | number; label: string; sub: ReactNode }) {
  return (
    <div className="health-metric">
      <div className={`health-icon ${tone}`} />
      <strong>{value}</strong>
      <span>{label}</span>
      <small>{sub}</small>
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
      <PageIntro title="Social Audit" description={connectedAccounts.length ? `Understand performance across your ${connectedAccounts.length} connected social accounts.` : "Connect your social accounts to explore performance and content opportunities."} art="research"><button className="primary" onClick={connectSocialMedia}><Megaphone size={14} />Connect social media</button></PageIntro>

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

function listValue(items?: string[]) {
  return (items || []).join(", ");
}

function PersonaChips({ items }: { items?: string[] }) {
  const values = (items || []).filter(Boolean);
  if (!values.length) return <span className="persona-empty">No entries yet</span>;
  return <div className="persona-chip-row">{values.map((item) => <span className="persona-chip" key={item}>{item}</span>)}</div>;
}

async function uploadReferenceFile(role: ReferenceRole, file: File): Promise<GenerationAssetReference> {
  const form = new FormData();
  form.set("role", role);
  form.set("file", file);
  const res = await fetch("/api/uploads", { method: "POST", body: form });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Upload failed for ${file.name}`);
  return {
    role,
    fileName: String(json.fileName || file.name),
    url: String(json.url || ""),
    storageKey: String(json.storageKey || ""),
    contentType: String(json.contentType || file.type || "")
  };
}

function PersonaMediaLibrary({ assets, onChange }: { assets: PersonaMediaAsset[]; onChange: (assets: PersonaMediaAsset[]) => void }) {
  const [uploadingRole, setUploadingRole] = useState<ReferenceRole | "">("");
  const addAsset = async (role: ReferenceRole, file?: File | null) => {
    if (!file?.name) return;
    setUploadingRole(role);
    try {
      const uploaded = await uploadReferenceFile(role, file);
      const asset: PersonaMediaAsset = {
        id: `pmedia_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        role,
        label: uploaded.fileName,
        fileName: uploaded.fileName,
        url: uploaded.url || "",
        storageKey: uploaded.storageKey,
        contentType: uploaded.contentType,
        createdAt: new Date().toISOString()
      };
      if (role === "logo" || role === "avatar/persona" || role === "audio") onChange([...assets.filter((item) => item.role !== role), asset]);
      else onChange([...assets, asset]);
    } finally {
      setUploadingRole("");
    }
  };
  const updateLabel = (id: string, label: string) => onChange(assets.map((item) => item.id === id ? { ...item, label } : item));
  const remove = (id: string) => onChange(assets.filter((item) => item.id !== id));
  const roles: ReferenceRole[] = ["logo", "avatar/persona", "product photo", "audio"];
  return (
    <div className="persona-media-library">
      <div className="media-upload-row">
        {roles.map((role) => (
          <label className="upbox compact" key={role}>
            <input type="file" accept={role === "audio" ? "audio/*" : "image/*"} onChange={(event) => void addAsset(role, event.currentTarget.files?.[0])} />
            {role === "audio" ? <Mic size={17} /> : role === "logo" ? <Sparkles size={17} /> : role === "avatar/persona" ? <UserRound size={17} /> : <Palette size={17} />}
            <b>{referenceLabelForRole(role)}</b>
            <span>{uploadingRole === role ? "Uploading..." : role === "product photo" ? "Can add many" : "One default"}</span>
          </label>
        ))}
      </div>
      <div className="persona-media-list">
        {assets.map((asset) => (
          <div className="persona-media-item" key={asset.id}>
            {asset.contentType?.startsWith("audio/") || asset.role === "audio" ? <div className="audio-chip"><Mic size={15} />Audio</div> : <img src={asset.url} alt={asset.label || asset.fileName} />}
            <div>
              <span>{referenceLabelForRole(asset.role)}</span>
              <input value={asset.label} onChange={(event) => updateLabel(asset.id, event.target.value)} />
              <small>{asset.fileName}</small>
            </div>
            <button type="button" onClick={() => remove(asset.id)}>Remove</button>
          </div>
        ))}
        {assets.length === 0 && <div className="empty-state compact">No saved persona media yet. Add reusable logo, avatar, product photos, or audio references.</div>}
      </div>
    </div>
  );
}

function PersonaPanel({ data, run, onEditingChange }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<any>; onEditingChange: (editing: boolean) => void }) {
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [editVersion, setEditVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [showAutofill, setShowAutofill] = useState(false);
  const [autoFilling, setAutoFilling] = useState(false);
  const [autofillError, setAutofillError] = useState("");
  const autofillBusy = useRef(false);
  const [autofillDraft, setAutofillDraft] = useState<PersonaProfile | null>(null);
  const persona = autofillDraft || data.personaProfile;
  useEffect(() => { onEditingChange(mode === "edit"); return () => onEditingChange(false); }, [mode, onEditingChange]);
  const cancelEdits = () => { setAutofillDraft(null); setMediaAssets(data.personaProfile.mediaAssets || []); setEditVersion(version => version + 1); setMode("preview"); };
  const storedMediaAssets = JSON.stringify(persona.mediaAssets || []);
  const [mediaAssets, setMediaAssets] = useState<PersonaMediaAsset[]>(persona.mediaAssets || []);
  useEffect(() => {
    // A failed action refreshes app data; an identical response must keep local edits.
    setMediaAssets(JSON.parse(storedMediaAssets) as PersonaMediaAsset[]);
  }, [persona.updatedAt, storedMediaAssets]);
  const completionChecks = [
    persona.displayName,
    persona.role,
    persona.company,
    persona.primaryAudience,
    persona.audienceInsight,
    persona.voiceStyle,
    persona.writingSamples.length
  ];
  const completion = Math.round((completionChecks.filter(Boolean).length / completionChecks.length) * 100);
  const save = async (form: FormData) => {
    form.set("mediaAssets", JSON.stringify(mediaAssets));
    Object.entries(persona.sourceUrls).forEach(([key, value]) => form.set(key + "Url", value));
    setSaving(true);
    try {
      const result = await run("updatePersonaProfile", Object.fromEntries(form.entries()), "Persona saved");
      if (result) { setAutofillDraft(null); setMode("preview"); }
    } finally { setSaving(false); }
  };
  const autoFill = async (form: HTMLFormElement) => {
    if (autofillBusy.current) return;
    const values = Object.fromEntries(new FormData(form).entries());
    if (!Object.values(values).some(value => String(value).trim())) {
      setAutofillError("Add at least one public profile or website URL.");
      return;
    }
    autofillBusy.current = true;
    setAutoFilling(true);
    setAutofillError("");
    try {
      const result = await run("autoFillPersonaProfile", { ...values, previewOnly: true }, "Persona draft prepared. Save to apply your changes.");
      if (result) { setAutofillDraft({ ...result, mediaAssets }); setEditVersion(version => version + 1); setShowAutofill(false); }
      else setAutofillError("We couldn’t auto-fill your profile. Your URLs are still here; please try again.");
    } finally { autofillBusy.current = false; setAutoFilling(false); }
  };
  return (
    <div className="persona-page">
      <div className="drift-banner">
        <div><b>Persona setup</b> - Store one active founder profile. Save applies your edits to the current profile.</div>
        <span className="badge">Single active profile</span>
      </div>

      <PageIntro title="Persona" description="Your voice, audience and brand references, ready for every creation." art="identity"><span className="last-upd">{data.personaProfile.updatedAt ? `Updated ${new Date(data.personaProfile.updatedAt).toLocaleString()}` : "Not saved yet"}</span>{mode === "preview" && <button type="button" className="primary" onClick={() => setMode("edit")}><Pencil size={16} />Edit persona</button>}
      </PageIntro>

      {mode === "edit" && <p className="persona-edit-notice" role="status"><Pencil size={17} />Editing persona · Save to apply your changes, or cancel to keep your saved profile.</p>}
      <section className="persona-summary">
        <Metric label="Profile completion" value={`${completion}%`} />
        <Metric label="Voice" value={persona.voiceStyle ? "set" : "missing"} />
        <Metric label="Sources" value={Object.values(persona.sourceUrls).filter(Boolean).length} />
      </section>

      {showAutofill && <ContentDialog title="Auto-fill persona" description="Use your public profiles to build your persona. Review the results before creating content." busy={autoFilling} onClose={() => setShowAutofill(false)}>
        <form onSubmit={event => { event.preventDefault(); void autoFill(event.currentTarget); }} className="persona-autofill-form">
          <p className="autofill-notice">Auto-fill updates this draft. Review the results and press Save persona to apply them.</p>
          <fieldset disabled={autoFilling} className="grid two">
            <label>LinkedIn<input name="linkedinUrl" defaultValue={persona.sourceUrls.linkedin} placeholder="linkedin.com/in/yourname" /></label>
            <label>Facebook<input name="facebookUrl" defaultValue={persona.sourceUrls.facebook || ""} placeholder="facebook.com/yourprofile" /></label>
            <label>Website<input name="websiteUrl" defaultValue={persona.sourceUrls.website} placeholder="yourcompany.com" /></label>
            <label>Instagram<input name="instagramUrl" defaultValue={persona.sourceUrls.instagram} placeholder="instagram.com/yourhandle" /></label>
            <label>X / Twitter<input name="xUrl" defaultValue={persona.sourceUrls.x} placeholder="x.com/yourhandle" /></label>
          </fieldset>
          {autofillError && <p role="alert" className="provider-error">{autofillError}</p>}
          <div className="dialog-actions"><button type="button" disabled={autoFilling} onClick={() => setShowAutofill(false)}>Cancel</button><button type="submit" className="primary" disabled={autoFilling}>{autoFilling ? <AnimatedDots label="Auto-filling persona" /> : "Auto-fill persona"}</button></div>
        </form>
      </ContentDialog>}
      {mode === "preview" && <PersonaPreview persona={data.personaProfile} />}
      <div hidden={mode !== "edit"}><form key={(persona.updatedAt || "unsaved") + editVersion} action={save} className="persona-setup"><fieldset className="persona-edit-fields" disabled={saving || autoFilling}>
        <div className="persona-step-head">
          <h3>Persona setup</h3>
          <span className="badge">Prompt voice source</span>
        </div>

        <section className="persona-card">
          <div className="persona-fields">
            <div className="autofill-banner"><span className="dot" /><span>Use the few fields below as the default prompt persona. Public URLs can auto-fill them when needed.</span><button id="persona-autofill-trigger" type="button" onClick={() => { setAutofillError(""); setShowAutofill(true); }}>Auto-fill</button></div>

            <div className="persona-advanced">
              <h2 className="persona-section-title">Core profile</h2><p className="persona-section-description">Introduce yourself and the business behind your content.</p>
              <div className="grid two">
                <label>Display name<input name="displayName" defaultValue={persona.displayName} placeholder="Sean C" /></label>
                <label>Role<input name="role" defaultValue={persona.role} placeholder="Founder / CEO" /></label>
              </div>
              <label>Company<input name="company" defaultValue={persona.company} placeholder="ContentAgent" /></label>
              <label>Company one-liner<input name="companyOneLiner" defaultValue={persona.companyOneLiner} placeholder="We help SMEs automate ops with AI" /></label>
            </div>

            <div className="persona-advanced">
              <h2 className="persona-section-title">Audience and voice</h2><p className="persona-section-description">Define who you speak to and how your content should sound.</p>
              <label>Primary audience<input name="primaryAudience" defaultValue={persona.primaryAudience} placeholder="SME owners and operators in SEA" /></label>
              <label>Audience insight<textarea name="audienceInsight" defaultValue={persona.audienceInsight} placeholder="They want automation wins, but worry about cost, complexity, and disruption." /></label>
              <div className="grid two">
                <label>Voice style<input name="voiceStyle" defaultValue={persona.voiceStyle} placeholder="friendly, practical, slightly humorous" /></label>
                <label>Content language<select name="contentLanguage" defaultValue={persona.contentLanguage}><option>English only</option><option>English + BM</option><option>English + Mandarin</option><option>Manglish</option><option>Multi-language</option></select></label>
              </div>
              <label>Writing samples<textarea name="writingSamples" defaultValue={listValue(persona.writingSamples)} placeholder="Paste up to 3 samples, separated by a blank line or comma." /></label>
            </div>

            <div className="persona-advanced">
              <h2 className="persona-section-title">Reusable media references</h2><p className="persona-section-description">Keep your brand and personal references ready for your next creation.</p>
              <p className="muted">These saved assets can be selected later in Create Content and Automation. Product photos can have multiple entries; logo, avatar, and audio keep one default each.</p>
              <PersonaMediaLibrary assets={mediaAssets} onChange={setMediaAssets} />
            </div>

            <details className="persona-advanced">
              <summary>Advanced prompt guardrails</summary>
              <label>Natural phrases<input name="naturalPhrases" defaultValue={listValue(persona.naturalPhrases)} placeholder="Here's the thing, Real talk" /></label>
              <PersonaChips items={persona.naturalPhrases} />
              <label>Banned vocabulary<input name="bannedVocabulary" defaultValue={listValue(persona.bannedVocabulary)} placeholder="synergy, disruptive" /></label>
              <PersonaChips items={persona.bannedVocabulary} />
              <label>Approved topics<input name="approvedTopics" defaultValue={listValue(persona.approvedTopics)} placeholder="AI automation, founder productivity" /></label>
              <PersonaChips items={persona.approvedTopics} />
              <label>Off-limits topics<input name="offLimitsTopics" defaultValue={listValue(persona.offLimitsTopics)} placeholder="Politics, medical advice" /></label>
              <PersonaChips items={persona.offLimitsTopics} />
              <label>Strong opinions<textarea name="strongOpinions" defaultValue={persona.strongOpinions} placeholder="AI will not replace jobs - it replaces tasks." /></label>
            </details>
          </div>
        </section>

        <div className="persona-footer">
          <span className="muted">Used by research video, image, and text generation prompts.</span>
          <div className="row-actions"><button type="button" disabled={saving} onClick={cancelEdits}>Cancel</button><button className="primary" type="submit" disabled={saving}><Check size={14} />{saving ? "Saving…" : "Save persona"}</button></div>
        </div>
      </fieldset></form></div>
    </div>
  );
}

function IntelligencePanel({ data, run, refresh, setDirectCreateInitial }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<any>; refresh: () => Promise<void>; setDirectCreateInitial: (initial: CreateContentInitial) => void }) {
  const [searchMode, setSearchMode] = useState<"url" | "keywords">("url");
  const [sortBy, setSortBy] = useState<"views" | "likes" | "date">("views");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [researchView, setResearchView] = useState<"history" | "search" | "results">("search");
  const [resultFilters, setResultFilters] = useState({ minViews: "", maxViews: "", minLikes: "", maxLikes: "" });
  const [searchUrl, setSearchUrl] = useState("");
  const [searchMinViews, setSearchMinViews] = useState("0");
  const [activeScanId, setActiveScanId] = useState<string | null>(null);
  const [keywordText, setKeywordText] = useState("");
  const [actorSource, setActorSource] = useState("instagram");
  const [contentType, setContentType] = useState("");
  const [uploadDate, setUploadDate] = useState("");
  const [scanStatus, setScanStatus] = useState<"url" | "keywords" | null>(null);
  const [pendingScan, setPendingScan] = useState<"url" | "keywords" | null>(null);
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
  const [scanElapsed, setScanElapsed] = useState(0);
  const [sourcePreview, setSourcePreview] = useState<SourceMediaPreview | null>(null);
  const activeScan = data.researchScans.find((scan) => scan.id === activeScanId);
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
    : [];
  const filteredResults = visibleResults.filter(item =>
    (resultFilters.minViews === "" || item.views >= Number(resultFilters.minViews)) &&
    (resultFilters.maxViews === "" || item.views <= Number(resultFilters.maxViews)) &&
    (resultFilters.minLikes === "" || item.likes >= Number(resultFilters.minLikes)) &&
    (resultFilters.maxLikes === "" || item.likes <= Number(resultFilters.maxLikes))
  );
  const sortedResults = [...filteredResults].sort((a, b) => {
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
  const openScan = (id: string) => {
    setActiveScanId(id);
    setResultFilters({ minViews: "", maxViews: "", minLikes: "", maxLikes: "" });
    setResearchView("results");
  };
  const newSearch = () => {
    setActiveScanId(null); setSearchUrl(""); setKeywordText(""); setSearchMinViews("0");
    setActorSource("instagram"); setContentType(""); setUploadDate(""); setResearchView("search");
  };
  const editSearch = () => {
    if (!activeScan) return;
    setSearchMode(activeScan.query || activeScan.url.startsWith("keyword:") ? "keywords" : "url");
    setKeywordText(scanLabel(activeScan)); setSearchUrl(activeScan.query ? "" : activeScan.url);
    setSearchMinViews(String(activeScan.minViews));
    setActorSource(activeScan.dimensions?.actorSources?.[0] || "instagram");
    setContentType(activeScan.dimensions?.contentType || activeScan.dimensions?.contentTypes?.[0] || "");
    setUploadDate(activeScan.dimensions?.uploadDate || ""); setActiveScanId(null); setResearchView("search");
  };
  const scanUrl = async (form: FormData) => {
    flushSync(() => {
      setPendingScan("url");
      setScanStatus("url");
      setScanStartedAt(Date.now());
    });
    try {
      const result = await run("scanResearchUrl", Object.fromEntries(form.entries()), "Research scan started. You can leave and come back later.");
      if (result?.id) openScan(result.id);
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
      if (result?.id) openScan(result.id);
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
  const historyScans = data.researchScans.filter(scan => scan.status !== "failed");
  const scanLabel = (scanItem: AppData["researchScans"][number]) => scanItem.query || (scanItem.url.startsWith("keyword:") ? scanItem.url.split("|")[0].replace("keyword:", "") : scanItem.url);
  return (
    <div className="research-page">
      {sourcePreview && <SourceMediaPreviewPanel source={sourcePreview} onClose={() => setSourcePreview(null)} />}
      <PageIntro title="Research" description="Revisit your saved searches or discover the next idea for your content." art="research">
        <div className="research-navigation">
          {researchView !== "history" && <button onClick={() => { setActiveScanId(null); setResearchView("history"); }}><ArrowLeft size={16} />Research history</button>}
          {researchView !== "search" && <button className="primary" onClick={newSearch} disabled={!!pendingScan}><Search size={16} />Search</button>}
        </div>
      </PageIntro>
      {researchView === "history" && <section className="research-card research-history">
        <div className="research-head"><div><h2>Research history</h2><p>Open a search to see its original query, filters and saved results.</p></div><button onClick={() => void refresh()}><RefreshCcw size={16} />Refresh history</button></div>
        <div className="research-history-list">
          {[...historyScans].sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(scan => <button key={scan.id} className="research-history-entry" onClick={() => openScan(scan.id)}>
            <span className="history-entry-icon"><Search size={20} /></span>
            <span className="history-entry-main"><b>{scanLabel(scan)}</b><span>{scan.query || scan.url.startsWith("keyword:") ? "Keyword search" : "URL search"} · {scan.dimensions?.actorSources?.join(", ") || scan.platform} · {new Date(scan.createdAt).toLocaleString()}</span><small>{scan.resultIds.length} saved results · Minimum {compact(scan.minViews)} views</small></span>
            {scan.status === "running" && <span className="history-entry-status running">Searching</span>}<ArrowRight size={18} />
          </button>)}
          {!historyScans.length && <div className="empty-state"><h3>Your research starts here</h3><p>Search by URL or keywords. Your searches and results will appear here.</p><button className="primary" onClick={newSearch}>Start a search</button></div>}
        </div>
      </section>}
      {researchView === "results" && activeScan && <section className="research-card saved-search-summary">
        <div className="research-head"><div><span className="clbl">{activeScan.query ? "Keyword search" : "URL search"}</span><h2>{scanLabel(activeScan)}</h2><p>{new Date(activeScan.createdAt).toLocaleString()} · {activeScan.dimensions?.actorSources?.join(", ") || activeScan.platform}</p></div><button onClick={editSearch} disabled={activeScan.status === "running"}>Edit search</button></div>
        <div className="saved-search-filters"><span>Minimum views: {compact(activeScan.minViews)}</span><span>Type: {activeScan.dimensions?.contentType || activeScan.dimensions?.contentTypes?.join(", ") || "All types"}</span><span>Upload date: {activeScan.dimensions?.uploadDate?.replaceAll("-", " ") || "Any time"}</span></div>
        {activeScan.status === "failed" && <p className="provider-error" role="alert">Search failed: {activeScan.error || "The provider could not complete this search. Edit the search to try again."}</p>}
        {activeScan.status !== "failed" && activeScan.error && <p className="provider-error">{activeScan.error}</p>}
        {activeScan.source === "fallback" && <p className="muted">Fallback results</p>}
      </section>}
      {researchView === "results" && <div className="research-kpis">

        <Metric label="Tracked sources" value={data.competitors.length} />
        <Metric label="Qualified results" value={sortedResults.length} />
        <Metric label="Total views" value={compact(totalViews)} />
        <Metric label="Top post" value={topResult ? compact(topResult.views) : "-"} />
      </div>}

      {researchView === "search" && <section className={`research-card ${activeScanStatus ? "loading" : ""}`}>
        <div className="research-mode">
          <button className={searchMode === "url" ? "on" : ""} onClick={() => setSearchMode("url")}><Radar size={14} />Search by URL</button>
          <button className={searchMode === "keywords" ? "on" : ""} onClick={() => setSearchMode("keywords")}><Search size={14} />Search by keywords</button>
        </div>
        {searchMode === "url" ? (
          <form onSubmit={(event) => { event.preventDefault(); if (!activeScanStatus) void scanUrl(new FormData(event.currentTarget)); }} className="research-form">
            <label>Social URL<input name="url" value={searchUrl} onChange={event => setSearchUrl(event.target.value)} type="url" placeholder="LinkedIn profile/page, TikTok, Instagram, YouTube, Facebook, or X URL" required /></label>
            <label>Minimum views<input name="minViews" type="number" min="0" step="1" value={searchMinViews} onChange={event => setSearchMinViews(event.target.value)} /></label>
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
              <Search size={14} />{activeScanStatus === "url" ? "Searching..." : "Search"}
            </button>
          </form>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); if (!activeScanStatus) void scanKeywords(new FormData(event.currentTarget)); }} className="keyword-form">
            <div className="keyword-input-row">
              <label>Keywords<input name="keywords" value={keywordText} onChange={(event) => setKeywordText(event.target.value)} placeholder="Enter keywords, e.g. sheila majid" required /></label>
              <label>Minimum views<input name="minViews" type="number" min="0" step="1" value={searchMinViews} onChange={event => setSearchMinViews(event.target.value)} /></label>
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
      </section>}

      {researchView === "results" && <section className={`research-card results-card ${activeScanStatus ? "loading" : ""}`} aria-busy={activeScanStatus ? "true" : "false"}>
        <div className="research-head">
          <div>
            <h3>Qualified competitor results</h3>
            <p aria-live="polite">{sortedResults.length} of {visibleResults.length} saved results · Filters update instantly.</p>
          </div>
          <div className="research-sort">
            <label>Sort by<select aria-label="Sort by" value={sortBy} onChange={event => setSortBy(event.target.value as "views" | "likes" | "date")}><option value="views">Views</option><option value="likes">Likes</option><option value="date">Date</option></select></label>
            <button className="sort-direction" aria-label={sortDir === "desc" ? "Descending order. Switch to ascending" : "Ascending order. Switch to descending"} title={sortDir === "desc" ? "Highest first" : "Lowest first"} onClick={() => setSortDir(dir => dir === "desc" ? "asc" : "desc")}>{sortDir === "desc" ? <ArrowDown size={20} /> : <ArrowUp size={20} />}</button>
          </div>
        </div>
        <div className="result-filters" aria-label="Filter saved results">
          {([["minViews", "Minimum view count"], ["maxViews", "Maximum view count"], ["minLikes", "Minimum like count"], ["maxLikes", "Maximum like count"]] as const).map(([key,label]) => <label key={key}>{label}<input type="number" min="0" step="1" placeholder={key.startsWith("min") ? "0" : "No limit"} value={resultFilters[key]} onChange={event => setResultFilters(previous => ({...previous, [key]: event.target.value}))} /></label>)}
          <button disabled={!Object.values(resultFilters).some(Boolean)} onClick={() => setResultFilters({minViews: "", maxViews: "", minLikes: "", maxLikes: ""})}>Clear filters</button>
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
              <button type="button" className="result-thumb" aria-label={"Preview " + item.title} onClick={() => openSourcePreview(item)}>{item.thumbnailUrl ? <img src={proxiedMediaUrl(item.thumbnailUrl)} alt="" /> : <span>{item.platform.slice(0, 2).toUpperCase()}</span>}</button>
              <div className="result-main">
                <button className="result-title-button" type="button" onClick={() => openSourcePreview(item)}>{item.title}</button>
                <span>{new Date(item.publishedAt).toLocaleString()} · captured {new Date(item.capturedAt).toLocaleDateString()}</span>
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
          {sortedResults.length === 0 && !activeScanStatus && <div className="empty-state">{visibleResults.length ? "No results match these view and like counts. Adjust or clear the filters to see more." : activeScan?.status === "failed" ? "This search could not be completed. Edit the search to try again." : "This search has no saved results. Edit the search to broaden its filters."}</div>}
        </div>
      </section>}

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
type ReferenceRole = AssetReference["role"];

function personaAssetToReference(asset: PersonaMediaAsset): GenerationAssetReference {
  return {
    role: asset.role,
    fileName: asset.label || asset.fileName,
    url: asset.url,
    storageKey: asset.storageKey,
    contentType: asset.contentType
  };
}

function referenceLabelForRole(role: ReferenceRole) {
  if (role === "product photo") return "Product photo";
  if (role === "avatar/persona") return "Avatar";
  if (role === "logo") return "Logo";
  return "Audio";
}

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

const automationModelOptions = {
  video: [
    { value: "veo-fast", label: "VEO Fast" },
    { value: "seedance-2.0", label: "Seedance 2.0" }
  ],
  image: [
    { value: "gpt-image-2", label: "GPT Image 2" },
    { value: "nanobanana-pro", label: "Nanobanana Pro" }
  ],
  text: [
    { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
    { value: "claude-opus-4.8", label: "Claude Opus 4.8" }
  ],
  auto: [
    { value: "auto", label: "Auto by selected source" },
    { value: "veo-fast", label: "VEO Fast for video" },
    { value: "gpt-image-2", label: "GPT Image 2 for image" },
    { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash for text" }
  ]
} as const;

function automationKindFromContentType(contentType: string): "video" | "image" | "text" | "auto" {
  if (contentType === "short-video" || contentType === "long-video" || contentType === "video") return "video";
  if (contentType === "text") return "text";
  if (contentType === "auto") return "auto";
  return "image";
}

function automationDefaultModel(contentType: string) {
  const kind = automationKindFromContentType(contentType);
  return automationModelOptions[kind][0].value;
}

function automationDimensionOptions(contentType: string, selectedPlatforms: Platform[] = []) {
  const kind = automationKindFromContentType(contentType);
  const has = (platform: Platform) => selectedPlatforms.includes(platform);
  if (kind === "text") return [] as { value: string; label: string }[];
  if (contentType === "long-video") return [{ value: "16:9", label: "16:9 landscape - YouTube / long video" }];
  if (contentType === "short-video" || contentType === "video") return [{ value: "9:16", label: "9:16 vertical - Reels / TikTok / Shorts" }, { value: "16:9", label: "16:9 landscape - YouTube / Facebook video" }];
  if (kind === "auto") return [{ value: "9:16", label: "9:16 vertical default" }, { value: "16:9", label: "16:9 landscape fallback" }];
  const options = [
    { value: "4:5", label: "4:5 portrait - Instagram / Facebook feed" },
    { value: "1:1", label: "1:1 square - Instagram / Facebook" },
    { value: "9:16", label: "9:16 story/reel cover" },
    { value: "16:9", label: "16:9 landscape - LinkedIn / website / YouTube community" }
  ];
  if (selectedPlatforms.length === 0) return options;
  if (has("LinkedIn") && !has("Instagram") && !has("TikTok")) return [options[3], options[0], options[1]];
  if (has("Instagram") || has("Facebook")) return options;
  return options;
}

function automationDefaultAspectRatio(contentType: string, selectedPlatforms: Platform[] = []) {
  return automationDimensionOptions(contentType, selectedPlatforms)[0]?.value || "1:1";
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
      {sourcePreview && <SourceMediaPreviewPanel source={sourcePreview} onClose={() => setSourcePreview(null)} />}
      {previewAsset?.assetUrl && <AssetPreviewPanel asset={previewAsset} onClose={() => setPreviewAsset(null)} />}
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
                  {aiError && <div role="alert" className="provider-error">{aiError}</div>}
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
          personaAssets={data.personaProfile.mediaAssets || []}
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

function CreateContentModule({ initial, persona, personaAssets = [], onSubmit, onCancel, onUsePlan, onStart, submitLabel = "Generate", busyLabel = "Sending to Publish", allowAiAssist = false }: { initial: CreateContentInitial; persona?: PersonaProfile; personaAssets?: PersonaMediaAsset[]; onSubmit: (payload: Record<string, unknown>) => Promise<void>; onCancel?: () => void; onUsePlan?: () => void; onStart?: (generation: PendingGeneration) => void; submitLabel?: string; busyLabel?: string; allowAiAssist?: boolean }) {
  const [activeInitial, setActiveInitial] = useState<CreateContentInitial>(initial);
  const [formVersion, setFormVersion] = useState(0);
  const [kind, setKind] = useState<GenerationKind>(initial.kind);
  const [model, setModel] = useState<string>(initial.model || generationModels[initial.kind][0][0]);
  const [duration, setDuration] = useState(closestDuration(initial.duration || 8, durationOptionsForModel(initial.model || generationModels[initial.kind][0][0])));
  const [platform, setPlatform] = useState<Platform>(initial.platform || defaultPlatformForKind(initial.kind));
  const [usePersona, setUsePersona] = useState(true);
  const [aspectRatio, setAspectRatio] = useState(initial.aspectRatio || "9:16");
  const [tone, setTone] = useState("Practical founder-led");
  const [length, setLength] = useState("Medium");
  const [variants, setVariants] = useState("1");
  const [submitError, setSubmitError] = useState("");
  const submitBusy = useRef(false);
  const [busy, setBusy] = useState(false);
  const [aiPromptOpen, setAiPromptOpen] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const aiBusy = useRef(false);
  const [aiError, setAiError] = useState("");
  const [aiIdea, setAiIdea] = useState("");
  const [assetRefs, setAssetRefs] = useState<AssetReference[]>([]);
  const [selectedPersonaAssetIds, setSelectedPersonaAssetIds] = useState<string[]>([]);
  const assetRefsRef = useRef<AssetReference[]>([]);
  const durationOptions = durationOptionsForModel(model);
  const visualAssetsEnabled = kind === "video" || kind === "image";
  const resetFormFromInitial = (next: CreateContentInitial) => {
    const nextModel = next.model || generationModels[next.kind][0][0];
    setActiveInitial(next);
    setKind(next.kind);
    setModel(nextModel);
    setAspectRatio(next.aspectRatio || (next.kind === "image" ? "4:5" : "9:16"));
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
    setAspectRatio(next === "image" ? "4:5" : "9:16");
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
  const togglePersonaAsset = (id: string, checked: boolean) => {
    setSelectedPersonaAssetIds((current) => checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id));
  };
  const generateAiDraft = async () => {
    if (aiBusy.current) return;
    const idea = aiIdea.trim();
    if (!idea) {
      setAiError("Tell me what you want to create first.");
      return;
    }
    setAiError("");
    aiBusy.current = true;
    setAiGenerating(true);
    try {
      const draft = await post("generateBriefWithAi", {
        idea,
        usePersona,
        requestedFormat: preferredFormatForKind(kind, aspectRatio),
        requestedDuration: kind === "video" ? duration : undefined,
        requestedModel: model
      }) as PlanDraft;
      resetFormFromInitial(createContentInitialFromDraft(draft));
      setAiPromptOpen(false);
      setAiIdea("");
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "AI generation failed.");
    } finally {
      aiBusy.current = false;
      setAiGenerating(false);
    }
  };
  const submit = async (form: FormData) => {
    if (submitBusy.current) return;
    submitBusy.current = true;
    setSubmitError("");
    setBusy(true);
    try {
      const selectedPlatform = String(form.get("platform") || platform || defaultPlatformForKind(kind));
      onStart?.({
        title: activeInitial.sourceTitle,
        description: visualAssetsEnabled && (assetRefs.length || selectedPersonaAssetIds.length) ? "Preparing selected references and provider generation." : "Preparing provider generation.",
        kind,
        model,
        startedAt: Date.now()
      });
      const personaRefs = personaAssets.filter((asset) => usePersona && selectedPersonaAssetIds.includes(asset.id)).map(personaAssetToReference);
      const cleanRefs = visualAssetsEnabled ? [...personaRefs, ...await uploadAssetReferences(assetRefs)] : [];
      const promptWithDuration = withSelectedVideoDuration(String(form.get("prompt") || ""), kind, duration);
      const prompt = enrichPromptForSocialConversion(promptWithDuration, kind, cleanRefs);
      await onSubmit({
        platform: selectedPlatform,
        usePersona,
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
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Could not queue content. Your edits are still here.");
    } finally {
      submitBusy.current = false;
      setBusy(false);
    }
  };
  return (
    <form key={formVersion} onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget)); }} className="generation-form create-generation-form">
      <fieldset className="creation-fields" disabled={busy || aiGenerating}>
      <section className="create-card creation-persona">
        <h2>Choose a persona</h2><p className="muted">Select your saved voice and references, or create without a persona.</p>
        <div className="persona-choice-grid">
          <button type="button" aria-pressed={usePersona} className={usePersona ? "on" : ""} onClick={() => setUsePersona(true)}><UserRound size={22} /><span><b>{persona?.displayName || "Saved persona"}</b><small>{[persona?.role, persona?.company].filter(Boolean).join(" · ") || "Use saved voice and audience"}</small></span></button>
          <button type="button" aria-pressed={!usePersona} className={!usePersona ? "on" : ""} onClick={() => { setUsePersona(false); setSelectedPersonaAssetIds([]); }}><Sparkles size={22} /><span><b>No persona</b><small>Use only your brief and chosen uploads</small></span></button>
        </div>
        {!usePersona && <p className="muted">Saved persona context and references will not be added. Review any text already in your brief before generating.</p>}
      </section>
      <section className="create-card">
        <div className="optional-brief-heading"><h2>Generate Brief</h2><span className="badge">Optional</span></div>
        <div className="brief-preview">
          <span>{activeInitial.sourceLabel}</span>
          <b>{activeInitial.sourceTitle}</b>
          <p>{activeInitial.sourceDescription}</p>
        </div>
        <div className="source-actions">
          {allowAiAssist && <button type="button" className="primary" onClick={() => setAiPromptOpen(true)} disabled={aiGenerating}><Sparkles size={14} />Generate Brief</button>}
          {onUsePlan && <button type="button" className="linkish secondary-plan-link" onClick={onUsePlan}>Load from Content Plan</button>}
        </div>
        <p className="step-helper">Use AI to prepare a brief, or skip this and write your generation prompt directly below.</p>
        {aiPromptOpen && (
          <div className="ai-plan-box compact">
            <div className="ai-plan-inner">
              <label>Tell me in a sentence or few, then I will fill the fields below.
                <textarea name="idea" disabled={aiGenerating} value={aiIdea} onChange={(event) => setAiIdea(event.target.value)} placeholder="Example: Create a 9:16 product demo video for busy SME founders about invoice follow-up automation." autoFocus />
              </label>
              {aiError && <div role="alert" className="provider-error">{aiError}</div>}
              <div className="row-actions">
                <button className="primary" type="button" onClick={() => void generateAiDraft()} disabled={aiGenerating}><Sparkles size={14} />{aiGenerating ? <AnimatedDots label="Preparing brief" /> : aiError ? "Try again" : "Fill fields"}</button>
                <button type="button" onClick={() => setAiPromptOpen(false)} disabled={aiGenerating}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="create-card">
        <div className="step-label">Choose format, model, and references</div>
        <ChoiceButtons label="Primary platform" name="platform" value={platform} options={Array.from(new Set([...platforms, "YouTube"])).map(value => ({value,label:value}))} onChange={value => setPlatform(value as Platform)} />
        <div className="create-type-grid">
          <button type="button" aria-pressed={kind === "video"} className={kind === "video" ? "on" : ""} onClick={() => changeKind("video")}><b>Video</b><span>TikTok, Reels, Shorts</span></button>
          <button type="button" aria-pressed={kind === "image"} className={kind === "image" ? "on" : ""} onClick={() => changeKind("image")}><b>Image</b><span>Instagram, LinkedIn, Facebook</span></button>
          <button type="button" aria-pressed={kind === "text"} className={kind === "text" ? "on" : ""} onClick={() => changeKind("text")}><b>Text post</b><span>LinkedIn, X, Threads</span></button>
        </div>
        <div className="plat-row">
          {placementsForKind(kind).map((label) => <span className="pc on" key={label}><span className="pd" />{label}</span>)}
        </div>
        <div className="creation-option-group">
        <div className="clbl">Generation settings</div>
        <div className="generation-choice-grid">
          {kind === "video" && <ChoiceButtons label="Duration" name="duration" value={duration} options={durationOptions.map(value => ({value:String(value),label:value + " seconds"}))} onChange={setDuration} />}
          {kind !== "text" && <ChoiceButtons label="Aspect ratio" name="aspectRatio" value={aspectRatio} options={(kind === "video" ? ["9:16", "16:9"] : ["1:1", "4:5", "16:9", "9:16"]).map(value => ({value,label:value}))} onChange={setAspectRatio} />}
          {kind === "image" && <ChoiceButtons label="Variants" name="variants" value={variants} options={["1","2","3","4"].map(value => ({value,label:value}))} onChange={setVariants} />}
          {kind === "text" && <><ChoiceButtons label="Tone" name="tone" value={tone} options={["Practical founder-led","Educational","Contrarian","Executive concise"].map(value => ({value,label:value}))} onChange={setTone} /><ChoiceButtons label="Length" name="length" value={length} options={["Short","Medium","Long"].map(value => ({value,label:value}))} onChange={setLength} /></>}
        </div>
        </div>

        <div className="creation-option-group"><div className="clbl">Model</div>
        <div className="model-options create-model-options">
          {generationModels[kind].map(([value, label, price]) => (
            <button type="button" key={value} aria-pressed={model === value} className={model === value ? "on" : ""} onClick={() => changeModel(value)}>
              <span className="mcard-dot" />
              <b>{label}</b>
              <span>{price}</span>
            </button>
          ))}
        </div></div>

      {visualAssetsEnabled && (
        <div className="creation-option-group">
          <div className="clbl">Optional reference assets</div>
          <ReferenceAssetPicker personaAssets={usePersona ? personaAssets : []} selectedIds={selectedPersonaAssetIds} onTogglePersona={togglePersonaAsset} uploadRefs={assetRefs} onUploadChange={updateAssetRef} video={kind === "video"} />
        </div>
      )}
      </section>


      <section className="create-card">
        <div className="step-label">Your content</div>
        <label>Generation prompt<textarea aria-label="Generation prompt" required name="prompt" defaultValue={activeInitial.prompt} /></label>
        <label>Caption<textarea name="caption" defaultValue={activeInitial.caption} /></label>
        <label>Hashtags<input name="hashtags" defaultValue={activeInitial.hashtags} /></label>
        {submitError && <p className="provider-error" role="alert">{submitError}</p>}
        <div className="ftrow">
          <div>Selected: <b>{model}</b></div>
          <div className="row-actions">
            {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
            <button className="primary" disabled={busy}><Wand2 size={14} />{busy ? <AnimatedDots label={busyLabel} /> : submitLabel}</button>
          </div>
        </div>
      </section>
      </fieldset>
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

function ReferenceAssetPicker({ personaAssets, selectedIds, onTogglePersona, uploadRefs, onUploadChange, video }: { personaAssets: PersonaMediaAsset[]; selectedIds: string[]; onTogglePersona: (id: string, checked: boolean) => void; uploadRefs: AssetReference[]; onUploadChange: (role: ReferenceRole, file?: File | null) => void; video: boolean }) {
  const allowedRoles: ReferenceRole[] = video ? ["product photo", "avatar/persona", "logo", "audio"] : ["product photo", "avatar/persona", "logo"];
  const filtered = personaAssets.filter((asset) => allowedRoles.includes(asset.role));
  return (
    <div className="reference-picker">
      <div className="clbl">Choose from Persona</div>
      <div className="persona-reference-grid">
        {filtered.map((asset) => (
          <label className={`persona-reference-card ${selectedIds.includes(asset.id) ? "on" : ""}`} key={asset.id}>
            <input type="checkbox" checked={selectedIds.includes(asset.id)} onChange={(event) => onTogglePersona(asset.id, event.target.checked)} />
            {asset.contentType?.startsWith("audio/") || asset.role === "audio" ? <div className="audio-chip"><Mic size={15} />Audio</div> : <img src={asset.url} alt={asset.label || asset.fileName} />}
            <span>{asset.label || asset.fileName}</span>
            <small>{referenceLabelForRole(asset.role)}</small>
          </label>
        ))}
        {filtered.length === 0 && <div className="empty-state compact">No saved persona assets for this content type yet.</div>}
      </div>
      <div className="clbl">Or upload for this generation</div>
      <div className="upload-pair three">
        <AssetUploadBox icon={<Palette size={18} />} title="Product photo" helper="Optional visual reference" role="product photo" refs={uploadRefs} onChange={onUploadChange} />
        <AssetUploadBox icon={<UserRound size={18} />} title="Override avatar" helper="Optional persona reference" role="avatar/persona" refs={uploadRefs} onChange={onUploadChange} />
        <AssetUploadBox icon={<Sparkles size={18} />} title="Logo" helper="Optional brand mark" role="logo" refs={uploadRefs} onChange={onUploadChange} />
        {video && <AssetUploadBox icon={<Mic size={18} />} title="Audio" helper="Optional audio reference" role="audio" refs={uploadRefs} onChange={onUploadChange} />}
      </div>
    </div>
  );
}

function GenerationModal({ brief, personaAssets, onClose, onStart, onSubmit }: { brief: Brief; personaAssets: PersonaMediaAsset[]; onClose: () => void; onStart?: (generation: PendingGeneration) => void; onSubmit: (payload: Record<string, unknown>) => Promise<void> }) {
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
        <CreateContentModule initial={initial} personaAssets={personaAssets} onCancel={onClose} onStart={onStart} submitLabel="Create asset" onSubmit={(payload) => onSubmit({ ...payload, id: brief.id })} />
      </section>
    </div>
  );
}

function useInlineFocus(identity: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus({ preventScroll: true });
    return () => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, [identity]);
  return ref;
}

function ResearchInlineEditor({ initial, persona, personaAssets, run, onClose, setScreen, setPendingGeneration }: { initial: CreateContentInitial; persona?: PersonaProfile; personaAssets: PersonaMediaAsset[]; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<any>; onClose: () => void; setScreen: (screen: string) => void; setPendingGeneration: (generation: PendingGeneration | null) => void }) {
  const editorRef = useInlineFocus(initial);
  const [promptReview, setPromptReview] = useState<{ videoPrompt: string } | null>(null);
  const [pendingPayload, setPendingPayload] = useState<Record<string, unknown> | null>(null);
  const [generating, setGenerating] = useState(false);
  const [submissionError, setSubmissionError] = useState("");
  useEffect(() => { editorRef.current?.focus({ preventScroll: true }); }, [promptReview, editorRef]);
  const queueGeneration = async (payload: Record<string, unknown>) => {
    setSubmissionError("");
    setPendingGeneration({
        title: initial.sourceTitle,
        description: "Preparing provider generation from the selected research result.",
        kind: String(payload.generationType || initial.kind) as GenerationKind,
        model: String(payload.generationModel || initial.model || ""),
        startedAt: Date.now()
    });
    const result = await run("generateDirectContent", {
      ...payload,
      sourceResultId: initial.sourceResultId,
      sourceUrl: initial.sourceUrl,
      sourceTitle: initial.sourceTitle,
      sourceThumbnailUrl: initial.sourceThumbnailUrl,
      sourceMediaUrl: initial.sourceMediaUrl,
      sourceMediaType: initial.sourceMediaType
    }, "Generation queued in Publish");
    setPendingGeneration(null);
    if (!result) {
      setSubmissionError("We could not queue this content. Your edits are still here; try again when ready.");
      return false;
    }
    onClose();
    setScreen("publish");
    return true;
  };
  const prepareGeneration = async (payload: Record<string, unknown>) => {
    setSubmissionError("");
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
    if (!finalPrompt) { setSubmissionError("The prompt could not be prepared. Your edits are still here; try again."); return; }
    setPendingPayload({ ...payload, prompt: finalPrompt });
    setPromptReview({ videoPrompt: finalPrompt });
  };
  const confirmVideoPrompt = async () => {
    if (!pendingPayload || generating) return;
    setGenerating(true);
    try {
      await queueGeneration(pendingPayload);
    } finally {
      setGenerating(false);
    }
  };
  return (
    <div ref={editorRef} tabIndex={-1} className="inline-editor" id="research-inline-editor" aria-label="Create from research">
      <section className="generation-modal research-generate-modal">
        <div className="modal-head">
          <div>
            <div className="clbl">{promptReview ? "Review before generating" : "Generate from research"}</div>
            <h3>{promptReview ? "Your video prompt" : initial.sourceTitle}</h3>
            <p>{promptReview ? "Review your refined prompt. Video generation starts only when you choose Generate video." : "Review the prefilled fields, attach replacement logo/person/audio references if needed, then generate the final asset."}</p>
          </div>
          <button type="button" className="icon-btn" disabled={generating} aria-label={promptReview ? "Back to editing" : "Close prompt editor"} onClick={promptReview ? () => { setPromptReview(null); setPendingPayload(null); } : onClose}>x</button>
        </div>
        {submissionError && <p className="provider-error inline" role="alert">{submissionError}</p>}
        {promptReview && (
          <div className="g01-review">
            <label>Video prompt<textarea readOnly value={promptReview.videoPrompt} /></label>
            <div className="ftrow">
              <div>{promptReview.videoPrompt.length} prompt characters</div>
              <div className="row-actions">
                <button type="button" onClick={() => { setPromptReview(null); setPendingPayload(null); }} disabled={generating}>Back to editing</button>
                <button type="button" className="primary" onClick={() => void confirmVideoPrompt()} disabled={generating}><Check size={14} />{generating ? <AnimatedDots label="Queuing" /> : "Generate video"}</button>
              </div>
            </div>
          </div>
        )}
        <div hidden={Boolean(promptReview)}>
          <CreateContentModule initial={initial} persona={persona} personaAssets={personaAssets} onCancel={onClose} submitLabel="Generate" busyLabel={initial.kind === "video" ? "Preparing your prompt" : "Sending to Publish"} onSubmit={prepareGeneration} />
        </div>
      </section>
    </div>
  );
}

function CreateContentPanel({ data, run, setScreen, setPendingGeneration }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<any>; setScreen: (screen: string) => void; setPendingGeneration: (generation: PendingGeneration | null) => void }) {
  const context = data.workspace.niche?.trim() || "your brand";
  const defaultInitial: CreateContentInitial = {
    sourceLabel: "Direct generation",
    sourceTitle: "Generate from scratch",
    sourceDescription: "Use this to create a new asset directly. Your outputs stay in My Contents after generation starts.",
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
      <div className="composer-heading"><div><h2>Create Content</h2><p>Choose your direction, write your prompt, and generate.</p></div></div>
      <CreateContentModule
        initial={initial}
        persona={data.personaProfile}
        personaAssets={data.personaProfile.mediaAssets || []}
        allowAiAssist
        onCancel={() => setScreen("publish")}
        onSubmit={async (payload) => {
          const result = await run("generateDirectContent", {
            ...payload,
            sourceResultId: initial.sourceResultId,
            sourceUrl: initial.sourceUrl,
            sourceTitle: initial.sourceTitle,
            sourceThumbnailUrl: initial.sourceThumbnailUrl,
            sourceMediaUrl: initial.sourceMediaUrl,
            sourceMediaType: initial.sourceMediaType
          }, "Generation queued in Publish");
          setPendingGeneration(null);
          if (!result) throw new Error("Could not queue content. Your edits are still here; please try again.");
          setScreen("publish");
        }}
      />
    </div>
  );
}

function DramaWorkspacePanel({ src, title, refresh }: { src: string; title: string; refresh: () => Promise<void> }) {
  useEffect(() => {
    const onDramaQueueUpdate = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.data?.type === "cabuild:drama-queue-updated"
      ) {
        void refresh();
      }
    };
    window.addEventListener("message", onDramaQueueUpdate);
    return () => window.removeEventListener("message", onDramaQueueUpdate);
  }, [refresh]);
  return (
    <section className="contents-studio-shell" aria-label={title + " workspace"}>
      <iframe className="contents-studio-frame" src={src} title={title} />
    </section>
  );
}

function PublishPanel({ data, run, pendingGeneration, onCreate, onLibrary, composer }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<void>; pendingGeneration: PendingGeneration | null; onCreate: () => void; onLibrary: () => void; composer?: ReactNode }) {
  const [infoItem, setInfoItem] = useState<PublishItem | null>(null);
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [sourcePreview, setSourcePreview] = useState<SourceMediaPreview | null>(null);
  const [generationNotice, setGenerationNotice] = useState("");
  const notifiedRef = useRef<Set<string>>(new Set());
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const queue = [...contentCreatorQueue(data.publishQueue, data.assets)].sort((a, b) => new Date(b.createdAt || b.scheduledAt).getTime() - new Date(a.createdAt || a.scheduledAt).getTime());
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
      setGenerationNotice(item.status === "done" ? `${item.title} is ready in My Contents.` : `${item.title} failed. Open Logs for the provider error.`);
    });
    if (!generationNotice) return;
    const timer = window.setTimeout(() => setGenerationNotice(""), 7000);
    return () => window.clearTimeout(timer);
  }, [queue, generationNotice]);
  return (
    <div className="publish-page">
      {sourcePreview && <SourceMediaPreviewPanel source={sourcePreview} onClose={() => setSourcePreview(null)} />}
      {previewAsset?.assetUrl && <AssetPreviewPanel asset={previewAsset} onClose={() => setPreviewAsset(null)} />}

      {infoItem && <ContentInfo item={infoItem} asset={data.assets.find(asset => asset.id === infoItem.assetId)} onClose={() => setInfoItem(null)} />}
      <PageIntro title="My Contents" description="Create, review and download your Content Creator outputs." art="library">{composer ? <button type="button" className="primary" onClick={onLibrary}><ArrowLeft size={17} />My Contents</button> : <button type="button" className="primary" onClick={onCreate}><Plus size={17} />Create Content</button>}
      </PageIntro>
      {generationNotice && <div className="generation-notice">{generationNotice}</div>}
      {composer}
      <div className="publish-list" hidden={Boolean(composer)}>
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
          const previewableAsset: Asset = { id: item.assetId, workspaceId: item.workspaceId, briefId: "", title: item.title, type: isImage ? "image" : "video", status: "ready", progress: 100, createdAt: item.createdAt || item.scheduledAt, ...asset, assetUrl: videoUrl || imageUrl || asset?.assetUrl };
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
          return <ContentOutputCard key={item.id} item={item} asset={asset} onPreview={() => setPreviewAsset(previewableAsset)} onInfo={() => setInfoItem(item)} onSource={sourceMedia ? () => setSourcePreview(sourceMedia) : undefined} />;
        })}
        {queue.length === 0 && !pendingGeneration && <div className="empty-state">No content yet. Choose Create Content above to make your first image, video or post.</div>}
      </div>

    </div>
  );
}

function SourceMediaPreviewPanel({ source, onClose }: { source: SourceMediaPreview; onClose: () => void }) {
  const [mediaFailed, setMediaFailed] = useState(false);
  const playable = source.mediaUrl || "";
  const isVideo = source.mediaType === "video" || /\.(mp4|webm|mov|m3u8)(\?|$)/i.test(playable);
  const isImage = source.mediaType === "image" || /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(playable);
  const imageUrl = isImage && playable ? playable : source.thumbnailUrl;
  const displayImageUrl = proxiedMediaUrl(imageUrl);
  return (
    <ContentDialog title="Media preview" description={source.platform || "Research source"} onClose={onClose}>
      <section className="source-media-popup">
        <h3>{source.title}</h3>
        {!mediaFailed && playable && isVideo ? (
          <video src={playable} controls autoPlay playsInline onError={() => setMediaFailed(true)} />
        ) : !mediaFailed && displayImageUrl ? (
          <img className="asset-preview-image" onError={() => setMediaFailed(true)} src={displayImageUrl} alt={`${source.title} source preview`} />
        ) : (
          <div className="source-media-empty">
            <Film size={28} />
            <b>{mediaFailed ? "This media preview could not be loaded" : "No media preview is available"}</b>
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
    </ContentDialog>
  );
}

function AssetPreviewPanel({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const [unavailable, setUnavailable] = useState(false);
  const isImage = asset.type === "image" || asset.type === "carousel";
  return <ContentDialog title={isImage ? "Image preview" : "Video preview"} description={asset.title} onClose={onClose}>
    <section className="source-media-popup">
      {unavailable ? <div className="source-media-empty"><b>Preview could not be loaded</b><span>You can still try downloading the original file.</span></div> : isImage ? <img className="asset-preview-image" src={asset.assetUrl} alt={asset.title} onError={() => setUnavailable(true)} /> : <video src={asset.assetUrl} controls autoPlay playsInline onError={() => setUnavailable(true)} />}
      <div className="modal-actions"><a className="asset-link" href={"/api/assets/" + asset.id + "/download"}>{isImage ? "Download image" : "Download MP4"}</a><button type="button" onClick={onClose}>Close</button></div>
    </section>
  </ContentDialog>;
}
function AnalyticsPanel({ data }: { data: AppData }) {
  return <div className="insights-page"><PageIntro title="Analyze" description="Explore your workspace counts and opportunity scores. The forecast below is a demonstration value." art="research" /><div className="grid three"><Metric label="Example engagement forecast" value="4.8%" /><Metric label="Published posts" value={data.publishQueue.filter((p) => p.status === "published").length} /><Metric label="Avg gap score" value={Math.round(data.opportunities.reduce((sum, item) => sum + item.gapScore, 0) / Math.max(1, data.opportunities.length))} /><PanelCard title="Feedback loop"><p>Published assets retain their originating brief, template, platform, and score so future recommendations can learn from performance results.</p></PanelCard></div></div>;
}

function LogPanel({ data }: { data: AppData }) {
  const [provider, setProvider] = useState("all");
  const [status, setStatus] = useState("all");
  const providers = Array.from(new Set((data.debugLogs || []).map((item) => item.provider).filter(Boolean))) as string[];
  const logs = (data.debugLogs || []).filter((item) => (provider === "all" || item.provider === provider) && (status === "all" || item.status === status));
  return (
    <div className="log-page">
      <PageIntro title="Logs" description="Follow each action from request to result, with provider details when you need them." art="text"><div className="log-filters">
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
      </PageIntro>
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
  const [automationMode, setAutomationMode] = useState<"scheduled" | "sources">("sources");
  const [expanded, setExpanded] = useState(data.automationRules.length === 0);
  const [sourceExpanded, setSourceExpanded] = useState((data.automationSourceWatchers || []).length === 0);
  const [dedupeMode, setDedupeMode] = useState<AutomationRule["duplicateProtection"]["mode"]>("standard");
  const [sourceContentType, setSourceContentType] = useState<AutomationSourceWatcher["contentType"]>("auto");
  const [sourceModel, setSourceModel] = useState("auto");
  const [sourceAspectRatio, setSourceAspectRatio] = useState("9:16");
  const [scheduledContentType, setScheduledContentType] = useState<AutomationRule["contentType"]>("image");
  const [scheduledModel, setScheduledModel] = useState("gpt-image-2");
  const [scheduledPlatforms, setScheduledPlatforms] = useState<Platform[]>(["Facebook"]);
  const [scheduledAspectRatio, setScheduledAspectRatio] = useState("4:5");
  const [sourceSelectedPersonaAssetIds, setSourceSelectedPersonaAssetIds] = useState<string[]>([]);
  const [sourceUploadRefs, setSourceUploadRefs] = useState<AssetReference[]>([]);
  const [scheduledSelectedPersonaAssetIds, setScheduledSelectedPersonaAssetIds] = useState<string[]>([]);
  const [scheduledUploadRefs, setScheduledUploadRefs] = useState<AssetReference[]>([]);
  const rules = data.automationRules || [];
  const jobs = data.automationJobs || [];
  const sourceWatchers = data.automationSourceWatchers || [];
  const sourceRuns = data.automationSourceRuns || [];
  const weekdayOptions = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const contentTypes: { value: AutomationRule["contentType"]; label: string }[] = [
    { value: "image", label: "Image" },
    { value: "short-video", label: "Short video" },
    { value: "long-video", label: "Long video" },
    { value: "text", label: "Text post" }
  ];
  const sourceModelOptions = automationModelOptions[automationKindFromContentType(sourceContentType)];
  const sourceDimensionOptions = automationDimensionOptions(sourceContentType);
  const scheduledModelOptions = automationModelOptions[automationKindFromContentType(scheduledContentType)];
  const scheduledDimensionOptions = automationDimensionOptions(scheduledContentType, scheduledPlatforms);
  const changeSourceContentType = (value: AutomationSourceWatcher["contentType"]) => {
    setSourceContentType(value);
    setSourceModel(automationDefaultModel(value));
    setSourceAspectRatio(automationDefaultAspectRatio(value));
  };
  const changeScheduledContentType = (value: AutomationRule["contentType"]) => {
    setScheduledContentType(value);
    setScheduledModel(automationDefaultModel(value));
    setScheduledAspectRatio(automationDefaultAspectRatio(value, scheduledPlatforms));
  };
  const toggleScheduledPlatform = (platform: Platform, checked: boolean) => {
    const next = checked ? Array.from(new Set([...scheduledPlatforms, platform])) : scheduledPlatforms.filter((item) => item !== platform);
    setScheduledPlatforms(next);
    const allowed = automationDimensionOptions(scheduledContentType, next);
    if (allowed.length && !allowed.some((item) => item.value === scheduledAspectRatio)) setScheduledAspectRatio(allowed[0].value);
  };
  const toggleSourcePersonaAsset = (id: string, checked: boolean) => setSourceSelectedPersonaAssetIds((current) => checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id));
  const toggleScheduledPersonaAsset = (id: string, checked: boolean) => setScheduledSelectedPersonaAssetIds((current) => checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id));
  const updateSourceUploadRef = (role: ReferenceRole, file?: File | null) => {
    setSourceUploadRefs((current) => {
      const existing = current.find((item) => item.role === role);
      if (existing) URL.revokeObjectURL(existing.previewUrl);
      const rest = current.filter((item) => item.role !== role);
      return file?.name ? [...rest, { role, fileName: file.name, previewUrl: URL.createObjectURL(file), file }] : rest;
    });
  };
  const updateScheduledUploadRef = (role: ReferenceRole, file?: File | null) => {
    setScheduledUploadRefs((current) => {
      const existing = current.find((item) => item.role === role);
      if (existing) URL.revokeObjectURL(existing.previewUrl);
      const rest = current.filter((item) => item.role !== role);
      return file?.name ? [...rest, { role, fileName: file.name, previewUrl: URL.createObjectURL(file), file }] : rest;
    });
  };
  const buildReferenceAssets = async (selectedIds: string[], uploads: AssetReference[]) => [
    ...(data.personaProfile.mediaAssets || []).filter((asset) => selectedIds.includes(asset.id)).map(personaAssetToReference),
    ...await uploadAssetReferences(uploads)
  ];
  const jobStatusLabel: Record<AutomationJob["status"], string> = {
    pending: "Pending",
    "checking-duplicates": "Checking duplicates",
    "ready-for-generation": "Ready draft",
    "skipped-duplicate": "Skipped duplicate",
    failed: "Failed"
  };
  const sourceContentTypes: { value: AutomationSourceWatcher["contentType"]; label: string }[] = [
    { value: "auto", label: "Auto choose" },
    { value: "video", label: "Video" },
    { value: "image", label: "Image" },
    { value: "text", label: "Text post" }
  ];

  return (
    <div className="automation-page">
      <PageIntro title="Automation" description={automationMode === "sources" ? "Follow your sources and turn fresh inspiration into a repeatable workflow." : "Set your content direction, schedule and review preferences in one place."} art="operations"><button className="primary" type="button" onClick={() => automationMode === "sources" ? setSourceExpanded((value) => !value) : setExpanded((value) => !value)}><Plus size={15} />{automationMode === "sources" ? sourceExpanded ? "Hide watcher" : "New watcher" : expanded ? "Hide builder" : "New automation"}</button>
      </PageIntro>

      <div className="automation-tabs">
        <button className={automationMode === "sources" ? "on" : ""} onClick={() => setAutomationMode("sources")}>Source Watcher</button>
        <button className={automationMode === "scheduled" ? "on" : ""} onClick={() => setAutomationMode("scheduled")}>Scheduled Content</button>
      </div>

      <div className="automation-summary">
        {automationMode === "sources" ? (
          <>
            <Metric label="Active watchers" value={sourceWatchers.filter((item) => item.status === "active").length} />
            <Metric label="Source runs" value={sourceRuns.length} />
            <Metric label="Content created" value={sourceRuns.filter((item) => item.publishItemId).length} />
          </>
        ) : (
          <>
            <Metric label="Active rules" value={rules.filter((item) => item.status === "active").length} />
            <Metric label="Draft jobs" value={jobs.filter((item) => item.status === "ready-for-generation").length} />
            <Metric label="Duplicates skipped" value={jobs.filter((item) => item.status === "skipped-duplicate").length} />
          </>
        )}
      </div>

      {automationMode === "sources" && sourceExpanded && (
        <PanelCard title="Build Source Watcher">
          <form className="automation-builder" action={async (form) => {
            const payload: Record<string, unknown> = Object.fromEntries(form.entries());
            payload.postingDays = form.getAll("postingDays").map((item) => String(item));
            payload.referenceAssets = await buildReferenceAssets(sourceSelectedPersonaAssetIds, sourceUploadRefs);
            return run("createSourceWatcher", payload, "Source Watcher saved");
          }}>
            <div className="automation-section-head"><span>Step 1</span><b>Sources to monitor</b></div>
            <div className="modal-grid">
              <label>Watcher name<input name="name" placeholder="Competitor best-post monitor" required /></label>
              <label>Ranking<select name="rankingMode" defaultValue="balanced">
                <option value="balanced">Balanced</option>
                <option value="views">Views</option>
                <option value="engagement">Engagement</option>
                <option value="recent">Recent</option>
              </select></label>
            </div>
            <label>Social media URLs<textarea name="sourceUrls" required placeholder={"https://www.instagram.com/example/\nhttps://www.tiktok.com/@example\nhttps://www.linkedin.com/company/example"} /></label>
            <div className="modal-grid">
              <label>Minimum views<input name="minViews" type="number" min="0" defaultValue="0" /></label>
              <label>Content type<select name="contentType" value={sourceContentType} onChange={(event) => changeSourceContentType(event.target.value as AutomationSourceWatcher["contentType"])}>{sourceContentTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label>Default model<select name="model" value={sourceModel} onChange={(event) => setSourceModel(event.target.value)}>{sourceModelOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              {sourceDimensionOptions.length > 0 ? (
                <label>Dimension<select name="aspectRatio" value={sourceAspectRatio} onChange={(event) => setSourceAspectRatio(event.target.value)}>
                  {sourceDimensionOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select></label>
              ) : <input type="hidden" name="aspectRatio" value="1:1" />}
            </div>
            <label>Creation instruction<textarea name="instruction" placeholder="Recreate the best performing source content for my persona. Replace original logo/person/audio with my uploaded references where provided." /></label>
            <div className="automation-section-head"><span>Step 2</span><b>Schedule and publishing</b></div>
            <div className="modal-grid">
              <label>Frequency<select name="frequency" defaultValue="daily"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="custom">Custom days</option></select></label>
              <label>Run time<input name="postingTime" type="time" defaultValue="10:00" /></label>
              <label>Timezone<input name="timezone" defaultValue="Asia/Kuala_Lumpur" /></label>
              <label>Approval mode<select name="approvalMode" defaultValue="draft-only">
                <option value="draft-only">Create draft only</option>
                <option value="generate-and-wait">Generate asset, wait for approval</option>
                <option value="auto-schedule">Generate and schedule</option>
                <option value="auto-publish">Auto publish through Upload-Post</option>
              </select></label>
              {automationKindFromContentType(sourceContentType) !== "image" && automationKindFromContentType(sourceContentType) !== "text" && <label>Video duration<input name="duration" type="number" min="4" max="15" defaultValue="8" /></label>}
            </div>
            <div className="automation-choice-row">
              {weekdayOptions.map((day) => <label className="check-card compact" key={day}><input name="postingDays" type="checkbox" value={day} defaultChecked={["Mon", "Wed", "Fri"].includes(day)} />{day}</label>)}
            </div>
            <div className="automation-section-head"><span>Step 3</span><b>User references for recreation</b></div>
            <ReferenceAssetPicker personaAssets={data.personaProfile.mediaAssets || []} selectedIds={sourceSelectedPersonaAssetIds} onTogglePersona={toggleSourcePersonaAsset} uploadRefs={sourceUploadRefs} onUploadChange={updateSourceUploadRef} video={automationKindFromContentType(sourceContentType) !== "image" && automationKindFromContentType(sourceContentType) !== "text"} />
            <div className="modal-grid">
              <label>Source window days<input name="sourceWindowDays" type="number" min="1" defaultValue="90" /></label>
              <label>Topic window days<input name="topicWindowDays" type="number" min="1" defaultValue="45" /></label>
              <label>Similarity threshold<input name="similarityThreshold" type="number" min="50" max="98" defaultValue="82" /></label>
            </div>
            <p className="muted">Each run crawls the URLs, stores source results, skips duplicate sources/topics, creates content in My Contents, and uses Upload-Post only when the selected approval mode allows publishing.</p>
            <button className="primary"><Radar size={15} />Save Source Watcher</button>
          </form>
        </PanelCard>
      )}

      {automationMode === "scheduled" && expanded && (
        <PanelCard title="Build automation">
          <form className="automation-builder" action={async (form) => {
            const payload: Record<string, unknown> = Object.fromEntries(form.entries());
            payload.platforms = form.getAll("platforms").map((item) => String(item));
            payload.postingDays = form.getAll("postingDays").map((item) => String(item));
            payload.referenceAssets = await buildReferenceAssets(scheduledSelectedPersonaAssetIds, scheduledUploadRefs);
            return run("createAutomationRule", payload, "Automation rule saved");
          }}>
            <div className="automation-section-head">
              <span>Step 1</span>
              <b>What should the agent create?</b>
            </div>
            <div className="modal-grid">
              <label>Automation name<input name="name" placeholder="Daily Malay loan ads" required /></label>
              <label>Goal<select name="goal" defaultValue="leads">
                <option value="leads">Leads</option>
                <option value="awareness">Awareness</option>
                <option value="engagement">Engagement</option>
                <option value="authority">Authority</option>
                <option value="sales">Sales</option>
              </select></label>
            </div>
            <label>Main instruction<textarea name="instruction" required placeholder="Create Malay FB ads for loan enquiries with a strong hook, compliance-safe USP, and clear CTA." /></label>
            <div className="automation-choice-row">
              {platforms.map((platform) => <label className="check-card" key={platform}><input name="platforms" type="checkbox" value={platform} checked={scheduledPlatforms.includes(platform)} onChange={(event) => toggleScheduledPlatform(platform, event.target.checked)} />{platform}</label>)}
            </div>
            <div className="modal-grid">
              <label>Content type<select name="contentType" value={scheduledContentType} onChange={(event) => changeScheduledContentType(event.target.value as AutomationRule["contentType"])}>{contentTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              {scheduledDimensionOptions.length > 0 ? (
                <label>Dimension<select name="aspectRatio" value={scheduledAspectRatio} onChange={(event) => setScheduledAspectRatio(event.target.value)}>
                  {scheduledDimensionOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select></label>
              ) : <input type="hidden" name="aspectRatio" value="1:1" />}
              <label>Default model<select name="model" value={scheduledModel} onChange={(event) => setScheduledModel(event.target.value)}>{scheduledModelOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label>Approval mode<select name="approvalMode" defaultValue="draft-only">
                <option value="draft-only">Draft only</option>
                <option value="generate-and-wait">Generate asset, wait for approval</option>
                <option value="auto-schedule">Generate and schedule</option>
                <option value="auto-publish">Auto publish</option>
              </select></label>
            </div>

            <div className="automation-section-head">
              <span>Step 2</span>
              <b>Schedule and research inputs</b>
            </div>
            <div className="modal-grid">
              <label>Frequency<select name="frequency" defaultValue="weekly">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="custom">Custom days</option>
              </select></label>
              <label>Posting time<input name="postingTime" type="time" defaultValue="10:00" /></label>
              <label>Timezone<input name="timezone" defaultValue="Asia/Kuala_Lumpur" /></label>
              <label>Quantity per run<input name="quantityPerRun" type="number" min="1" max="5" defaultValue="1" /></label>
            </div>
            <div className="automation-choice-row">
              {weekdayOptions.map((day) => <label className="check-card compact" key={day}><input name="postingDays" type="checkbox" value={day} defaultChecked={["Mon", "Wed", "Fri"].includes(day)} />{day}</label>)}
            </div>
            <div className="modal-grid">
              <label>Research mode<select name="researchMode" defaultValue="keywords">
                <option value="keywords">Use keywords</option>
                <option value="latest-research">Use latest Research results</option>
                <option value="none">No research input</option>
              </select></label>
              <label>Keywords<textarea name="keywords" placeholder="personal loan, SME loan, fast approval" /></label>
              <label>Source URLs<textarea name="sourceUrls" placeholder="Optional competitor or reference URLs, one per line" /></label>
              <label>Restrictions<textarea name="restrictions" placeholder="Avoid guaranteed approval, cash piles, misleading claims..." /></label>
            </div>

            <div className="automation-section-head">
              <span>Step 3</span>
              <b>References and duplicate protection</b>
            </div>
            <ReferenceAssetPicker personaAssets={data.personaProfile.mediaAssets || []} selectedIds={scheduledSelectedPersonaAssetIds} onTogglePersona={toggleScheduledPersonaAsset} uploadRefs={scheduledUploadRefs} onUploadChange={updateScheduledUploadRef} video={automationKindFromContentType(scheduledContentType) === "video"} />
            <div className="modal-grid">
              <label>Protection level<select name="duplicateMode" value={dedupeMode} onChange={(event) => setDedupeMode(event.target.value as AutomationRule["duplicateProtection"]["mode"])}>
                <option value="off">Off</option>
                <option value="light">Light</option>
                <option value="standard">Standard</option>
                <option value="strict">Strict</option>
              </select></label>
              <label>Source window days<input name="sourceWindowDays" type="number" min="1" defaultValue={dedupeMode === "strict" ? 180 : 90} /></label>
              <label>Topic window days<input name="topicWindowDays" type="number" min="1" defaultValue={dedupeMode === "strict" ? 120 : 45} /></label>
              <label>Similarity threshold<input name="similarityThreshold" type="number" min="50" max="98" defaultValue={dedupeMode === "strict" ? 76 : dedupeMode === "light" ? 90 : 82} /></label>
              <label>Retry new idea attempts<input name="maxRetries" type="number" min="0" max="5" defaultValue={dedupeMode === "off" ? 0 : 2} /></label>
            </div>
            <p className="muted">Duplicate checks compare source URLs, recent generated assets, publish queue entries, research titles, captions, and previous automation jobs before allowing a new draft job.</p>
            <button className="primary"><Sparkles size={15} />Save automation</button>
          </form>
        </PanelCard>
      )}

      {automationMode === "sources" ? (
      <div className="automation-grid">
        <PanelCard title="Source Watchers">
          <div className="automation-rule-list">
            {sourceWatchers.map((watcher) => (
              <article className="automation-rule-card" key={watcher.id}>
                <div className="rule-main">
                  <span className={`status ${watcher.status === "active" ? "scheduled" : watcher.status === "failed" ? "failed" : "draft"}`}>{watcher.status}</span>
                  <h3>{watcher.name}</h3>
                  <p>{watcher.instruction}</p>
                  <div className="rule-meta">
                    <span>{watcher.sourceUrls.length} source URL{watcher.sourceUrls.length === 1 ? "" : "s"}</span>
                    <span>{watcher.contentType} · {watcher.aspectRatio}</span>
                    <span>{watcher.frequency} at {watcher.postingTime}</span>
                    <span>{watcher.approvalMode}</span>
                  </div>
                </div>
                <div className="rule-actions">
                  <button type="button" onClick={() => run("runSourceWatcherNow", { id: watcher.id }, "Source Watcher run started")}>Run now</button>
                  <button type="button" onClick={() => run(watcher.status === "active" ? "pauseSourceWatcher" : "resumeSourceWatcher", { id: watcher.id }, watcher.status === "active" ? "Watcher paused" : "Watcher resumed")}>{watcher.status === "active" ? "Pause" : "Resume"}</button>
                  <button type="button" className="danger ghost" onClick={() => run("deleteSourceWatcher", { id: watcher.id }, "Source Watcher deleted")}>Delete</button>
                </div>
              </article>
            ))}
            {sourceWatchers.length === 0 && <div className="empty-state">No Source Watchers yet. Add social media URLs to monitor competitor content automatically.</div>}
          </div>
        </PanelCard>
        <PanelCard title="Source run history">
          <div className="automation-job-list">
            {sourceRuns.map((item) => (
              <article className="automation-job-row" key={item.id}>
                <div>
                  <b>{item.selectedTitle || item.status}</b>
                  <span>{item.status} · {new Date(item.startedAt).toLocaleString()} · {item.scannedCount} scanned</span>
                  <p>{item.selectionReason || item.error || "Run recorded."}</p>
                </div>
                <div className="job-score">
                  <strong>{item.selectedScore ? Math.round(item.selectedScore) : 0}</strong>
                  <span>score</span>
                </div>
              </article>
            ))}
            {sourceRuns.length === 0 && <div className="empty-state">No source runs yet. Use Run now to crawl the configured source URLs.</div>}
          </div>
        </PanelCard>
      </div>
      ) : (
      <div className="automation-grid">
        <PanelCard title="Automation rules">
          <div className="automation-rule-list">
            {rules.map((rule) => (
              <article className="automation-rule-card" key={rule.id}>
                <div className="rule-main">
                  <span className={`status ${rule.status === "active" ? "scheduled" : rule.status === "failed" ? "failed" : "draft"}`}>{rule.status}</span>
                  <h3>{rule.name}</h3>
                  <p>{rule.instruction}</p>
                  <div className="rule-meta">
                    <span>{rule.platforms.join(", ") || "No platform"}</span>
                    <span>{rule.contentType} · {rule.aspectRatio}</span>
                    <span>{rule.frequency} at {rule.postingTime}</span>
                    <span>Dedupe: {rule.duplicateProtection.mode}</span>
                  </div>
                </div>
                <div className="rule-actions">
                  <button type="button" onClick={() => run("runAutomationNow", { id: rule.id }, "Automation draft job created")}>Run now</button>
                  <button type="button" onClick={() => run(rule.status === "active" ? "pauseAutomationRule" : "resumeAutomationRule", { id: rule.id }, rule.status === "active" ? "Automation paused" : "Automation resumed")}>{rule.status === "active" ? "Pause" : "Resume"}</button>
                  <button type="button" className="danger ghost" onClick={() => run("deleteAutomationRule", { id: rule.id }, "Automation deleted")}>Delete</button>
                </div>
              </article>
            ))}
            {rules.length === 0 && <div className="empty-state">No automation rules yet. Create one to start generating scheduled draft jobs.</div>}
          </div>
        </PanelCard>

        <PanelCard title="Draft job history">
          <div className="automation-job-list">
            {jobs.map((job) => (
              <article className="automation-job-row" key={job.id}>
                <div>
                  <b>{job.title}</b>
                  <span>{jobStatusLabel[job.status]} · {new Date(job.createdAt).toLocaleString()}</span>
                  <p>{job.duplicateCheck.reason}</p>
                </div>
                <div className="job-score">
                  <strong>{Math.round(job.duplicateCheck.similarityScore * 100)}%</strong>
                  <span>match</span>
                </div>
              </article>
            ))}
            {jobs.length === 0 && <div className="empty-state">No automation jobs yet. Use Run now on a rule to create the first reviewed draft.</div>}
          </div>
        </PanelCard>
      </div>
      )}
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
          <p className="muted compact">Variables: <code>{"{{sourceMediaUrl}}"}</code>, <code>{"{{sourceUrl}}"}</code>, <code>{"{{sourceTitle}}"}</code>, <code>{"{{sourceDescription}}"}</code>, <code>{"{{durationLine}}"}</code>, <code>{"{{assetInstruction}}"}</code>, <code>{"{{personaContext}}"}</code>.</p>
          <label><span className="prompt-step">Step 2 - Edited prompt to final G01 JSON</span><textarea name="researchVideoPromptRefine" defaultValue={data.promptTemplates.researchVideoPromptRefine} /></label>
          <p className="muted compact">Variable: <code>{"{{prompt}}"}</code>. Persona context is attached to the source prompt before this step runs.</p>
        </section>
        <section className="prompt-module">
          <div className="prompt-module-head">
            <div>
              <b>Research Image Prompt</b>
              <span>Source image or carousel result to editable image-generation prompt.</span>
            </div>
          </div>
          <label><span className="prompt-step">Step 1 - Source to editable image prompt</span><textarea name="researchImageRecreate" defaultValue={data.promptTemplates.researchImageRecreate} /></label>
          <p className="muted compact">Variables: <code>{"{{sourceMediaUrl}}"}</code>, <code>{"{{sourceUrl}}"}</code>, <code>{"{{sourceTitle}}"}</code>, <code>{"{{sourceDescription}}"}</code>, <code>{"{{assetInstruction}}"}</code>, <code>{"{{personaContext}}"}</code>. Uploaded logo/person/product reference instructions are added later by the shared Create Content module.</p>
        </section>
        <section className="prompt-module">
          <div className="prompt-module-head">
            <div>
              <b>Research Text Prompt</b>
              <span>Source text/link result to editable text-post prompt.</span>
            </div>
          </div>
          <label><span className="prompt-step">Step 1 - Source to editable text prompt</span><textarea name="researchTextRecreate" defaultValue={data.promptTemplates.researchTextRecreate} /></label>
          <p className="muted compact">Variables: <code>{"{{sourceUrl}}"}</code>, <code>{"{{sourceTitle}}"}</code>, <code>{"{{sourceDescription}}"}</code>, <code>{"{{personaContext}}"}</code>. Text generation does not use logo/person/audio attachments.</p>
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

function AccountPanel({ data }: { data: AppData }) {
  return <div className="account-page"><PageIntro title="Account" eyebrow="Your workspace" description="Your signed-in identity and workspace membership." art="identity" />
    <section className="card"><h2>Account details</h2><dl className="account-details">
      <div><dt>Name</dt><dd>{data.user.name}</dd></div>
      <div><dt>Email</dt><dd>{data.user.email}</dd></div>
      <div><dt>Role</dt><dd>{data.user.role}</dd></div>
      <div><dt>Workspace</dt><dd>{data.workspace.name}</dd></div>
      <div><dt>Plan</dt><dd>{data.workspace.plan}</dd></div>
    </dl></section>
  </div>;
}

function SettingsPanel({ data, run, integrations }: { data: AppData; run: (a: string, p?: Record<string, unknown>, m?: string) => Promise<void>; integrations: IntegrationData | null }) {
  const [connectUrl, setConnectUrl] = useState("");
  const [connectError, setConnectError] = useState("");
  const canOpenAdmin = ["owner", "admin", "super_admin"].includes(data.user.role);
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
    <div className="settings-page"><PageIntro title="Settings" eyebrow="Account" description="Keep your workspace context and account connections in one place." art="operations" /><div className="grid two">
      <PanelCard title="Workspace context">
        <form className="brand-form" action={(form) => run("updateWorkspace", Object.fromEntries(form.entries()), "Workspace context saved")}>
          <label>Workspace name<input name="name" defaultValue={data.workspace.name} /></label>
          <label>Brand / niche<textarea name="niche" defaultValue={data.workspace.niche} /></label>
          <p className="muted">This Brand / niche value is passed into AI content-plan generation as context.</p>
          <button className="primary">Save workspace context</button>
        </form>
      </PanelCard>
      <PanelCard title="Connect social accounts">
        <p className="muted">Demo is configured to Upload-Post profile Mariana and publishes to TikTok, Facebook, and X. Use this only if you need to re-open the connection page.</p>
        <button className="primary" onClick={createConnectUrl}><Megaphone size={14} />Open Mariana connect link</button>
        {connectUrl && <p className="muted">Connection page opened in a new tab.</p>}
        {connectError && <p className="provider-error">{connectError}</p>}
      </PanelCard>
      {canOpenAdmin && (
        <PanelCard title="Admin controls moved">
          <p className="muted">Prompt templates, provider status, logs, and backend credentials are now managed from the separate admin surface.</p>
          <a className="asset-link" href="/admin">Open admin</a>
        </PanelCard>
      )}
    </div>
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

function isWithinDays(date: string | undefined, days: number) {
  if (!date) return false;
  const time = new Date(date).getTime();
  if (!Number.isFinite(time)) return false;
  return Date.now() - time <= days * 24 * 60 * 60 * 1000;
}

function relativeTime(date: string | undefined) {
  if (!date) return "";
  const time = new Date(date).getTime();
  if (!Number.isFinite(time)) return "";
  const diff = Math.max(0, Date.now() - time);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(date).toLocaleDateString();
}

function Score({ value }: { value: number }) {
  return <div className="score"><strong>{value}</strong><span style={{ width: `${value}%` }} /></div>;
}
