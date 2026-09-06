"use client";
import StatusToast, { useStatusToast } from "@/components/status-toast";
import PageIntro from "@/components/page-intro";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import GlobalHeader from "@/components/global-header";
import WorkspaceRail from "@/components/workspace-rail";
import {
  configureDramaStorageOwner,
  createLibraryAssetId,
  DELETED_ASSET_STORAGE_KEY,
  dramaStorageKey,
  LibraryAsset,
  markLibraryAssetUsed,
  readAssetLibrary,
  readDeletedAssetIds,
  REUSABLE_ASSET_STORAGE_KEY,
  writeAssetLibrary,
} from "@/lib/drama/asset-library";
import { useKieCredits } from "@/lib/drama/use-kie-credits";
import {
  CombinedEpisodeEntry,
  configureCombinedEpisodeOwner,
  readCombinedEpisodes,
} from "@/lib/drama/combined-episode-library";
import {
  Activity,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Clapperboard,
  Clock3,
  Copy,
  Download,
  Eye,
  EyeOff,
  Film,
  FolderKanban,
  Gauge,
  ImageIcon,
  KeyRound,
  LockKeyhole,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";

export type WorkspacePageName =
  | "overview"
  | "productions"
  | "production-detail"
  | "assets"
  | "settings"
  | "credentials"
  | "activity"
  | "info"
  | "help";

const pageMeta: Record<
  WorkspacePageName,
  { title: string; breadcrumb: string; description: string }
> = {
  overview: {
    title: "Overview",
    breadcrumb: "Workspace / Overview",
    description:
      "See every drama in progress and continue from the exact production step you last approved.",
  },
  productions: {
    title: "Drama",
    breadcrumb: "Workspace / Drama",
    description:
      "Manage active dramas, review generated outputs, and resume any production step.",
  },
  "production-detail": {
    title: "The Last Monsoon",
    breadcrumb: "Productions / The Last Monsoon",
    description:
      "The complete generated production record, organised by brief, story, assets, prompts, and video.",
  },
  assets: {
    title: "Asset Library",
    breadcrumb: "Workspace / Asset Library",
    description:
      "Reusable character, venue, and object references from every production.",
  },
  settings: {
    title: "Settings",
    breadcrumb: "Workspace / Settings",
    description:
      "Configure workspace defaults, generation behaviour, review rules, and provider access.",
  },
  credentials: {
    title: "Provider credentials",
    breadcrumb: "Settings / Provider credentials",
    description:
      "Connect the AI services used for story, image, voice, and video generation without exposing secret values to the browser.",
  },
  activity: {
    title: "Activity",
    breadcrumb: "Workspace / Activity",
    description:
      "A clear audit trail of generation, editing, approvals, fallback routing, and exports.",
  },
  info: {
    title: "Production Info",
    breadcrumb: "Drama / Production Info",
    description:
      "Review final episode videos together with every source image and generation prompt. This page is read-only.",
  },
  help: {
    title: "Help & guides",
    breadcrumb: "Workspace / Help",
    description:
      "Learn the guided workflow, credential setup, model routing, and episode assembly.",
  },
};

const formatWorkspaceDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return `${new Intl.DateTimeFormat("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Singapore",
  }).format(date)} SGT`;
};

const productionSteps = [
  {
    number: 1,
    label: "Creative brief",
    href: "/drama-studio",
    status: "Approved",
    detail: "Story, format & controls",
    icon: WandSparkles,
  },
  {
    number: 2,
    label: "Story Studio",
    href: "/drama-studio",
    status: "In review",
    detail: "Episodes, cast, assets & scene prompts",
    icon: FolderKanban,
  },
  {
    number: 3,
    label: "Generate & edit",
    href: "/drama-studio",
    status: "Ready",
    detail: "Video, recovery & assembly",
    icon: Clapperboard,
  },
];

type WorkspaceProduction = {
  id: string;
  title: string;
  logline: string;
  status: string;
  progress: number;
  episodes: number;
  createdAt: string;
  updated: string;
};

type OverviewRecord = {
  id: string;
  stage: number;
  name: string;
  createdAt?: string;
  snapshot?: {
    title?: string;
    roughStory?: string;
    generatedBrief?: string;
    storyline?: string;
    episodes?: number;
    assets?: Array<{ status?: string; resultUrl?: string }>;
    scenes?: Array<{ id?: string; status?: string; resultUrl?: string }>;
  };
};

function readWorkspaceProductions(): WorkspaceProduction[] {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(dramaStorageKey("drama-studio:workflow-library-v2")) ?? "{}",
    ) as { records?: OverviewRecord[] };
    const latestByTitle = new Map<string, OverviewRecord>();
    (parsed.records ?? [])
      .filter((record) => !record.id.startsWith("demo-"))
      .forEach((record) => {
        const title = record.snapshot?.title?.trim() || record.name.trim();
        if (!title) return;
        const key = title.toLocaleLowerCase();
        const current = latestByTitle.get(key);
        if (
          !current ||
          Date.parse(record.createdAt ?? "") >= Date.parse(current.createdAt ?? "")
        ) {
          latestByTitle.set(key, record);
        }
      });

    return [...latestByTitle.values()]
      .map((record) => {
        const snapshot = record.snapshot ?? {};
        const assets = snapshot.assets ?? [];
        const scenes = snapshot.scenes ?? [];
        const readyAssets = assets.filter(
          (asset) => asset.status === "ready" && asset.resultUrl,
        ).length;
        const readyScenes = scenes.filter(
          (scene) => scene.status === "ready" && scene.resultUrl,
        ).length;
        const hasStory = Boolean(snapshot.storyline?.trim());
        const progress = readyScenes
          ? 80
          : readyAssets
            ? 60
            : hasStory
              ? 40
              : 20;
        return {
          id: record.id,
          title: snapshot.title?.trim() || record.name,
          logline:
            snapshot.roughStory?.trim() ||
            snapshot.generatedBrief?.trim() ||
            snapshot.storyline?.trim() ||
            "Continue developing this production in Drama Studio.",
          status: readyScenes
            ? "Generating"
            : readyAssets
              ? "Assets ready"
              : hasStory
                ? "Story review"
                : "Draft",
          progress,
          episodes: Math.max(1, Number(snapshot.episodes) || 1),
          createdAt: record.createdAt ?? new Date(0).toISOString(),
          updated: record.createdAt
            ? formatWorkspaceDateTime(record.createdAt)
            : "Time unavailable",
        } satisfies WorkspaceProduction;
      })
      .sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt));
  } catch {
    return [];
  }
}

const assetItems = [
  {
    id: "aya",
    title: "Aya Lin",
    type: "Character",
    project: "The Last Monsoon",
    crop: "17% center",
  },
  {
    id: "ren",
    title: "Ren Kaito",
    type: "Character",
    project: "The Last Monsoon",
    crop: "34% center",
  },
  {
    id: "observatory",
    title: "Astra Observatory",
    type: "Venue",
    project: "The Last Monsoon",
    crop: "58% center",
  },
  {
    id: "recorder",
    title: "Brass recorder",
    type: "Object",
    project: "The Last Monsoon",
    crop: "91% center",
  },
  {
    id: "platform",
    title: "Harbour line",
    type: "Venue",
    project: "The Last Monsoon",
    crop: "78% center",
  },
  {
    id: "archive",
    title: "Archive fragments",
    type: "Object",
    project: "The Last Monsoon",
    crop: "97% center",
  },
];

export default function WorkspacePage({
  page,
  ownerId,
}: {
  page: WorkspacePageName;
  ownerId: string;
}) {
  configureDramaStorageOwner(ownerId);
  configureCombinedEpisodeOwner(ownerId);
  const { toast, setToast } = useStatusToast();
  const kieCredits = useKieCredits();
  const meta = pageMeta[page];

return (
    <div className="app-shell">
      <main className="main">
        <header className="topbar">
          <GlobalHeader
            activeMode="drama"
            activePage={
              page === "assets"
                ? "asset-library"
                : page === "info"
                  ? "production-info"
                  : undefined
            }
          />
        </header>

        <div className="workspace-content-frame drama-workspace-frame">
          <WorkspaceRail
            mode="drama"
            activePage={
              page === "assets"
                ? "asset-library"
                : page === "info"
                  ? "production-info"
                  : undefined
            }
          />
          <div className="main-panel workspace-main-panel">
          <PageIntro title={meta.title} description={meta.description} eyebrow="Drama Studio" tone="lilac" art={page === "assets" ? "library" : "story"}>{page === "overview" || page === "productions" ? (
              <Link href="/drama-studio" className="primary-button">
                <Plus size={14} /> New production
              </Link>
            ) : null}
          </PageIntro>

          {page === "overview" && (
            <OverviewContent setToast={setToast} kieCredits={kieCredits} />
          )}
          {page === "productions" && (
            <ProductionsContent setToast={setToast} />
          )}
          {page === "production-detail" && (
            <ProductionDetailContent setToast={setToast} />
          )}
          {page === "assets" && <AssetsContent setToast={setToast} />}
          {page === "settings" && <SettingsContent setToast={setToast} />}
          {page === "credentials" && (
            <CredentialsContent setToast={setToast} />
          )}
          {page === "activity" && <ActivityContent setToast={setToast} />}
          {page === "info" && <ProductionInfoContent />}
          {page === "help" && <HelpContent />}
          </div>
          <span className="workspace-rail-balance" aria-hidden="true" />
        </div>
      </main>

      <StatusToast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

function OverviewContent({
  setToast,
  kieCredits,
}: {
  setToast: (value: string) => void;
  kieCredits: ReturnType<typeof useKieCredits>;
}) {
  const [productions, setProductions] = useState<WorkspaceProduction[]>([]);
  const [generatedSceneCount, setGeneratedSceneCount] = useState(0);
  const [approvedAssetCount, setApprovedAssetCount] = useState(0);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setProductions(readWorkspaceProductions());
      setApprovedAssetCount(readAssetLibrary().length);
      try {
        const parsed = JSON.parse(
          window.localStorage.getItem(dramaStorageKey("drama-studio:workflow-library-v2")) ?? "{}",
        ) as { records?: OverviewRecord[] };
        const generatedScenes = new Set<string>();
        (parsed.records ?? []).forEach((record) => {
          record.snapshot?.scenes?.forEach((scene) => {
            if (scene.status === "ready" && scene.resultUrl) {
              generatedScenes.add(`${record.id}:${scene.id ?? scene.resultUrl}`);
            }
          });
        });
        setGeneratedSceneCount(generatedScenes.size);
      } catch {
        setGeneratedSceneCount(0);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const currentProduction = productions[0];
  const currentHref = currentProduction
    ? currentProduction.status === "Generating"
      ? "/drama-studio"
      : currentProduction.status === "Draft"
        ? "/drama-studio"
        : "/drama-studio"
    : "/drama-studio";

  return (
    <div className="workspace-page-grid">
      <section className="workspace-metrics">
        {[
          {
            label: "Active productions",
            value: String(productions.length),
            note: productions.length ? "Saved in this browser" : "Create your first drama",
            Icon: Film,
            tone: "blue",
          },
          {
            label: "Scenes generated",
            value: String(generatedSceneCount),
            note: generatedSceneCount ? "Ready video clips" : "No clips generated yet",
            Icon: Clapperboard,
            tone: "green",
          },
          {
            label: "Assets approved",
            value: String(approvedAssetCount),
            note: approvedAssetCount ? "Saved in Asset Library" : "No assets approved yet",
            Icon: ImageIcon,
            tone: "purple",
          },
          {
            label: "Credits remaining",
            value:
              kieCredits.status === "ready" && kieCredits.credits !== null
                ? new Intl.NumberFormat("en-US", {
                    maximumFractionDigits: 2,
                  }).format(kieCredits.credits)
                : "—",
            note:
              kieCredits.status === "ready"
                ? "Live Kie AI balance"
                : kieCredits.status === "missing"
                  ? "Add a KIE AI Key"
                  : kieCredits.status === "loading"
                    ? "Checking Kie AI"
                    : "Balance unavailable",
            Icon: Zap,
            tone: "amber",
          },
        ].map(({ label, value, note, Icon, tone }) => (
          <article className="workspace-metric" key={label}>
            <span className={`workspace-metric-icon ${tone}`}>
              <Icon size={16} />
            </span>
            <strong>{value}</strong>
            <span>{label}</span>
            <small>{note}</small>
          </article>
        ))}
      </section>

      <section className="card overview-production-card">
        {currentProduction ? (
          <>
            <div className="workspace-section-head">
              <div>
                <span className="result-label">Continue production</span>
                <h2>{currentProduction.title}</h2>
                <p>{currentProduction.logline}</p>
              </div>
              <span className="status-pill ready">{currentProduction.status}</span>
            </div>
            <div className="overview-step-row">
              {productionSteps.map((step) => {
                const Icon = step.icon;
                return (
                  <Link href={step.href} className="overview-step" key={step.number}>
                    <span><Icon size={14} /></span>
                    <b>{step.label}</b>
                    <small>Open workspace</small>
                  </Link>
                );
              })}
            </div>
            <div className="overview-card-actions">
              <div>
                <span className="status-pill ready">Latest activity</span>
                <b>{currentProduction.updated}</b>
              </div>
              <Link href={currentHref} className="primary-button">
                Continue production <ArrowRight size={14} />
              </Link>
            </div>
          </>
        ) : (
          <div className="empty-workspace-state">
            <Film size={24} />
            <h2>No productions yet</h2>
            <p>Create a creative brief to start your first AI drama.</p>
            <Link href="/drama-studio" className="primary-button">
              <Plus size={14} /> New production
            </Link>
          </div>
        )}
      </section>

      <div className="overview-bottom-grid">
        <section className="card">
          <div className="workspace-section-head compact">
            <div>
              <h2>Recent productions</h2>
              <p>Your latest drama workspaces.</p>
            </div>
            <Link href="/drama-studio" className="regenerate-link">
              View all <ArrowRight size={12} />
            </Link>
          </div>
          <div className="compact-production-list">
            {productions.slice(0, 3).map((production) => (
              <Link
                href="/drama-studio"
                key={production.id}
              >
                <span className="compact-project-mark">
                  {production.title
                    .split(" ")
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join("")}
                </span>
                <span>
                  <b>{production.title}</b>
                  <small>
                    {production.status} · {production.updated}
                  </small>
                </span>
                <ArrowRight size={14} />
              </Link>
            ))}
            {!productions.length && (
              <div className="empty-workspace-state">
                <Film size={20} />
                <p>Your productions will appear here after you create a brief.</p>
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="workspace-section-head compact">
            <div>
              <h2>Provider readiness</h2>
              <p>Generation services available to this browser.</p>
            </div>
            <Link href="/settings/credentials" className="regenerate-link">
              Manage <ArrowRight size={12} />
            </Link>
          </div>
          <div className="provider-readiness-list">
            {[
              [
                "Kie AI",
                kieCredits.status === "ready"
                  ? `${kieCredits.label} available`
                  : kieCredits.status === "missing"
                    ? "Needs KIE AI Key"
                    : kieCredits.status === "loading"
                      ? "Checking connection"
                      : "Temporarily unavailable",
                kieCredits.status === "ready" ? "green" : "amber",
              ],
              [
                "Kie Gemini 3 Pro",
                kieCredits.status === "ready"
                  ? "Available via Kie AI"
                  : "Needs connected Kie AI",
                kieCredits.status === "ready" ? "green" : "amber",
              ],
              [
                "Kie Seedream 4.5",
                kieCredits.status === "ready"
                  ? "Available via Kie AI"
                  : "Needs connected Kie AI",
                kieCredits.status === "ready" ? "green" : "amber",
              ],
              [
                "Kie Seedance 2.0",
                kieCredits.status === "ready"
                  ? "Available via Kie AI"
                  : "Needs connected Kie AI",
                kieCredits.status === "ready" ? "green" : "amber",
              ],
              ["FFmpeg assembly", "Ready", "green"],
            ].map(([name, status, tone]) => (
              <div key={name}>
                <span className={`provider-ready-dot ${tone}`} />
                <b>{name}</b>
                <span className={`provider-state ${tone}`}>{status}</span>
              </div>
            ))}
          </div>
          <button
            className="full-small-button"
            onClick={() => {
              void kieCredits.refresh();
              setToast("Refreshing Kie AI credits and provider readiness.");
            }}
          >
            <Activity size={13} /> Refresh provider status
          </button>
        </section>
      </div>
    </div>
  );
}

function ProductionsContent({
  setToast,
}: {
  setToast: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [sortOrder, setSortOrder] = useState("Newest");
  const [productions, setProductions] = useState<WorkspaceProduction[]>([]);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setProductions(readWorkspaceProductions()),
      0,
    );
    return () => window.clearTimeout(timeout);
  }, []);
  const visible = productions
    .filter(
      (production) =>
        production.title.toLowerCase().includes(query.toLowerCase()) &&
        (filter === "All" ||
          (filter === "Active" && production.progress > 15) ||
          production.status === filter),
    )
    .sort((first, second) => {
      if (sortOrder === "Oldest") {
        return Date.parse(first.createdAt) - Date.parse(second.createdAt);
      }
      if (sortOrder === "Title A–Z") {
        return first.title.localeCompare(second.title);
      }
      return Date.parse(second.createdAt) - Date.parse(first.createdAt);
    });

  const duplicate = (id: string) => {
    const source = productions.find((item) => item.id === id);
    if (!source) return;
    setProductions((current) => [
      ...current,
      {
        ...source,
        id: `${source.id}-copy-${Date.now()}`,
        title: `${source.title} — Copy`,
        status: "Draft",
        progress: 5,
        createdAt: new Date().toISOString(),
        updated: "Just now",
      },
    ]);
    setToast(`${source.title} duplicated as a new draft.`);
  };

  return (
    <div className="workspace-page-grid">
      <section className="card workspace-toolbar">
        <div className="workspace-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search productions"
            aria-label="Search productions"
          />
        </div>
        <div className="filter-tabs">
          {["All", "Active", "Story review", "Draft"].map((item) => (
            <button
              className={filter === item ? "active" : ""}
              onClick={() => setFilter(item)}
              key={item}
            >
              {item}
            </button>
          ))}
        </div>
        <label className="workspace-sort-select">
          <span>Sort</span>
          <select
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value)}
          >
            {["Newest", "Oldest", "Title A–Z"].map((option) => (
              <option value={option} key={option}>{option}</option>
            ))}
          </select>
          <ChevronDown size={13} />
        </label>
        <span className="toolbar-result-count">{visible.length} productions</span>
      </section>

      <div className="production-card-grid">
        {visible.map((production, index) => (
          <article className="production-card" key={production.id}>
            <div
              className={`production-card-cover production-cover-${index % 3}`}
            >
              {index === 0 && (
                <Image
                  src="/images/last-monsoon-concept.png"
                  alt=""
                  fill
                  sizes="(max-width: 720px) 100vw, 33vw"
                />
              )}
              <span className="production-card-status">
                {production.status}
              </span>
              <span className="production-card-progress">
                {production.progress}%
              </span>
            </div>
            <div className="production-card-body">
              <h2>{production.title}</h2>
              <p>{production.logline}</p>
              <div className="production-card-meta">
                <span>
                  <Film size={12} /> {production.episodes} episodes
                </span>
                <span>
                  <Clock3 size={12} /> Produced {formatWorkspaceDateTime(production.createdAt)}
                </span>
              </div>
              <div className="overview-progress-track compact">
                <span style={{ width: `${production.progress}%` }} />
              </div>
              <div className="production-card-actions">
                <Link
                  href={
                    production.id === "last-monsoon"
                      ? "/drama-studio"
                      : "/drama-studio"
                  }
                  className="primary-button"
                >
                  Open production <ArrowRight size={13} />
                </Link>
                <button
                  className="icon-button"
                  onClick={() => duplicate(production.id)}
                  aria-label={`Duplicate ${production.title}`}
                >
                  <Copy size={14} />
                </button>
              </div>
            </div>
          </article>
        ))}
        {!visible.length && (
          <div className="empty-workspace-state">
            <Search size={22} />
            <h2>No productions found</h2>
            <p>Try a different title or status filter.</p>
            <button
              className="secondary-button"
              onClick={() => {
                setQuery("");
                setFilter("All");
              }}
            >
              Clear filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ProductionDetailContent({
  setToast,
}: {
  setToast: (value: string) => void;
}) {
  const downloadManifest = () => {
    downloadText(
      "the-last-monsoon-production-manifest.json",
      JSON.stringify(
        {
          title: "The Last Monsoon",
          episodes: 8,
          progress: 80,
          approvedSteps: ["brief", "story", "assets"],
          selectedScenes: ["E01-S01", "E01-S02", "E01-S03", "E01-S04"],
        },
        null,
        2,
      ),
    );
    setToast("Production manifest downloaded.");
  };

  return (
    <div className="workspace-page-grid">
      <section className="production-detail-hero">
        <div className="production-detail-art">
          <Image
            src="/images/last-monsoon-concept.png"
            alt="The Last Monsoon concept board"
            fill
            priority
            sizes="(max-width: 720px) 100vw, 45vw"
          />
        </div>
        <div className="production-detail-copy">
          <span className="status-pill ready">In production · 80%</span>
          <h2>The Last Monsoon</h2>
          <p>
            A sceptical journalist receives a recording of her own voice
            predicting a city-wide disaster seven days before it happens.
          </p>
          <div className="detail-facts">
            <span>
              <Film size={13} /> 8 episodes
            </span>
            <span>
              <Clock3 size={13} /> 1 min each
            </span>
            <span>
              <Gauge size={13} /> PG-13
            </span>
          </div>
          <div className="inline-actions">
            <Link href="/drama-studio" className="primary-button">
              Continue production <ArrowRight size={14} />
            </Link>
            <button className="secondary-button" onClick={downloadManifest}>
              <Download size={14} /> Export manifest
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="workspace-section-head">
          <div>
            <span className="result-label">Generated production record</span>
            <h2>Open any step to review its current output</h2>
            <p>
              Every approved layer remains editable and visible on its own
              page.
            </p>
          </div>
        </div>
        <div className="production-record-grid">
          {productionSteps.map((step) => {
            const Icon = step.icon;
            return (
              <Link href={step.href} className="production-record-card" key={step.number}>
                <span className="record-icon">
                  <Icon size={18} />
                </span>
                <div>
                  <h3>{step.label}</h3>
                  <p>{step.detail}</p>
                </div>
                <span
                  className={`status-pill ${
                    step.status === "Approved" ? "ready" : "outline"
                  }`}
                >
                  {step.status}
                </span>
                <ArrowRight size={15} />
              </Link>
            );
          })}
        </div>
      </section>

      <div className="overview-bottom-grid">
        <section className="card">
          <div className="workspace-section-head compact">
            <div>
              <h2>Latest story output</h2>
              <p>Story Bible · Draft 01</p>
            </div>
            <Link href="/drama-studio" className="regenerate-link">
              Review story <ArrowRight size={12} />
            </Link>
          </div>
          <p className="generated-output-preview">
            Seven days before the largest monsoon in a generation reaches
            Meridian Bay, investigative journalist Aya Lin receives an
            impossible recording: her own voice, older and exhausted, naming
            people who will disappear when the observatory signal activates…
          </p>
          <div className="story-pill-row">
            <span>Truth vs survival</span>
            <span>Red thread motif</span>
            <span>Bittersweet ending</span>
          </div>
        </section>
        <section className="card">
          <div className="workspace-section-head compact">
            <div>
              <h2>Visual continuity pack</h2>
              <p>6 approved reusable references</p>
            </div>
            <Link href="/drama-studio" className="regenerate-link">
              Review Story Studio <ArrowRight size={12} />
            </Link>
          </div>
          <div className="detail-asset-strip">
            {assetItems.slice(0, 4).map((asset) => (
              <div key={asset.id}>
                <Image
                  src="/images/last-monsoon-concept.png"
                  alt={asset.title}
                  fill
                  sizes="120px"
                  style={{ objectPosition: asset.crop }}
                />
                <span>{asset.title}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function AssetsContent({
  setToast,
}: {
  setToast: (value: string) => void;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("All");
  const [sortOrder, setSortOrder] = useState("Newest");
  const [query, setQuery] = useState("");
  const [libraryAssets, setLibraryAssets] = useState<LibraryAsset[]>([]);
  const [deleteCandidate, setDeleteCandidate] = useState<LibraryAsset | null>(null);

  useEffect(() => {
    const deletedIds = new Set(readDeletedAssetIds());
    const merged = readAssetLibrary().filter((asset) => !deletedIds.has(asset.id));
    try {
      const workflow = JSON.parse(
        window.localStorage.getItem(dramaStorageKey("drama-studio:workflow-library-v2")) ?? "{}",
      ) as {
        records?: Array<{
          id: string;
          stage: number;
          model?: string;
          snapshot: {
            title: string;
            assets: Array<{
              id: string;
              name: string;
              type: LibraryAsset["type"];
              detail: string;
              visualPrompt?: string;
              resultUrl?: string;
              status: string;
              crop: string;
              libraryAssetId?: string;
            }>;
          };
        }>;
      };
      workflow.records?.forEach((record) => {
        if (
          (record.stage !== 2 && record.stage !== 3) ||
          record.model === "Asset Library"
        ) return;
        record.snapshot.assets.forEach((asset) => {
          if (
            asset.status !== "ready" ||
            !asset.resultUrl ||
            asset.libraryAssetId
          ) return;
          const item: LibraryAsset = {
            id: createLibraryAssetId(record.id, asset.id, asset.resultUrl),
            sourceRecordId: record.id,
            sourceAssetId: asset.id,
            name: asset.name,
            type: asset.type,
            detail: asset.detail,
            visualPrompt: asset.visualPrompt,
            resultUrl: asset.resultUrl,
            project: record.snapshot.title || "Untitled drama",
            crop: asset.crop,
            savedAt: new Date().toISOString(),
            usageCount: 0,
          };
          if (deletedIds.has(item.id)) return;
          const index = merged.findIndex(
            (existing) =>
              existing.id === item.id || existing.resultUrl === item.resultUrl,
          );
          if (index >= 0) {
            const existing = merged[index];
            merged[index] = {
              ...existing,
              ...item,
              id: existing.id,
              savedAt: existing.savedAt,
              usageCount: existing.usageCount ?? 0,
              lastUsedAt: existing.lastUsedAt,
            };
          }
          else merged.push(item);
        });
      });
    } catch {
      // The dedicated library still works if an old workflow cache is malformed.
    }
    writeAssetLibrary(merged);
    const timeout = window.setTimeout(() => setLibraryAssets(merged), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const visible = libraryAssets
    .filter(
      (asset) =>
        (filter === "All" || asset.type === filter) &&
        asset.name.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((first, second) => {
      if (sortOrder === "Oldest") {
        return Date.parse(first.savedAt) - Date.parse(second.savedAt);
      }
      if (sortOrder === "Name A–Z") {
        return first.name.localeCompare(second.name);
      }
      return Date.parse(second.savedAt) - Date.parse(first.savedAt);
    });

  const downloadPack = () => {
    downloadText(
      "drama-studio-asset-manifest.json",
      JSON.stringify(libraryAssets, null, 2),
    );
    setToast("Asset manifest downloaded.");
  };

  const reuseAsset = (asset: LibraryAsset) => {
    setLibraryAssets(markLibraryAssetUsed(asset.id));
    window.localStorage.setItem(dramaStorageKey(REUSABLE_ASSET_STORAGE_KEY), JSON.stringify(asset));
    router.push("/drama-studio");
  };

  const deleteAsset = () => {
    if (!deleteCandidate) return;
    const next = libraryAssets.filter((asset) => asset.id !== deleteCandidate.id);
    const deletedIds = new Set(readDeletedAssetIds());
    deletedIds.add(deleteCandidate.id);
    window.localStorage.setItem(
      dramaStorageKey(DELETED_ASSET_STORAGE_KEY),
      JSON.stringify([...deletedIds]),
    );
    writeAssetLibrary(next);
    setLibraryAssets(next);
    setToast(`${deleteCandidate.name} removed from Asset Library.`);
    setDeleteCandidate(null);
  };

  return (
    <div className="workspace-page-grid">
      <section className="card workspace-toolbar">
        <div className="workspace-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search assets"
            aria-label="Search assets"
          />
        </div>
        <div className="filter-tabs">
          {["All", "Character", "Venue", "Object"].map((item) => (
            <button
              className={filter === item ? "active" : ""}
              onClick={() => setFilter(item)}
              key={item}
            >
              {item}
            </button>
          ))}
        </div>
        <label className="workspace-sort-select">
          <span>Sort</span>
          <select
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value)}
          >
            {["Newest", "Oldest", "Name A–Z"].map((option) => (
              <option value={option} key={option}>{option}</option>
            ))}
          </select>
          <ChevronDown size={13} />
        </label>
        <button className="secondary-button" onClick={downloadPack}>
          <Download size={13} /> Export manifest
        </button>
      </section>

      {visible.length === 0 && (
        <section className="card empty-library-card">
          <ImageIcon size={24} />
          <h2>No generated assets saved yet</h2>
          <p>
            Images generated in Visual Assets are saved here automatically so
            you can reuse them later without generating them again.
          </p>
          <Link href="/drama-studio" className="primary-button">
            Open Story Studio <ArrowRight size={14} />
          </Link>
        </section>
      )}

      <div className="library-grid">
        {visible.map((asset) => (
          <article className="library-card" key={asset.id}>
            <div className="library-visual">
              <span
                className="library-generated-image"
                role="img"
                aria-label={asset.name}
                style={{ backgroundImage: `url(${JSON.stringify(asset.resultUrl)})` }}
              />
              <span className="asset-type">{asset.type}</span>
              <span className="library-lock">
                <ShieldCheck size={11} /> Generated asset
              </span>
            </div>
            <div className="library-card-body">
              <h2>{asset.name}</h2>
              <p>{asset.project}</p>
              <div className="library-asset-details">
                <span className="library-produced-at">
                  <Clock3 size={11} /> Generated {formatWorkspaceDateTime(asset.savedAt)}
                </span>
                <span className="library-usage-count">
                  <Eye size={11} /> Used {asset.usageCount ?? 0}{" "}
                  {(asset.usageCount ?? 0) === 1 ? "time" : "times"}
                </span>
              </div>
              <div className="library-prompt-readout">
                <span>Generation prompt</span>
                <p>{asset.visualPrompt || asset.detail || "Prompt unavailable"}</p>
              </div>
              <div className="production-card-actions">
                <button
                  className="primary-button"
                  onClick={() => reuseAsset(asset)}
                >
                  Reuse in Story Studio <ArrowRight size={14} />
                </button>
                <button
                  className="icon-button"
                  onClick={() => setDeleteCandidate(asset)}
                  aria-label={`Delete ${asset.name}`}
                  title="Delete asset"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {deleteCandidate && (
        <div className="confirmation-scrim" role="presentation">
          <section
            className="confirmation-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-asset-title"
          >
            <div className="confirmation-icon"><Trash2 size={18} /></div>
            <div>
              <span className="context-kicker">Confirm deletion</span>
              <h2 id="delete-asset-title">Delete {deleteCandidate.name}?</h2>
              <p>This removes the reusable copy from Asset Library. The original Visual Assets result remains unchanged.</p>
            </div>
            <div className="confirmation-actions">
              <button className="secondary-button" onClick={() => setDeleteCandidate(null)}>Cancel</button>
              <button className="danger-button" onClick={deleteAsset}>Delete asset</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function ProductionInfoContent() {
  const [episodes, setEpisodes] = useState<
    Array<CombinedEpisodeEntry & { url: string }>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const createdUrls: string[] = [];
    void readCombinedEpisodes()
      .then((entries) => {
        if (!active) return;
        setEpisodes(
          entries.map((entry) => {
            const url = URL.createObjectURL(entry.blob);
            createdUrls.push(url);
            return { ...entry, url };
          }),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  if (loading) {
    return (
      <section className="card production-info-loading" role="status">
        <Activity size={20} className="spin" />
        <div>
          <h2>Loading production information</h2>
          <p>Opening final episode videos and their generation sources.</p>
        </div>
      </section>
    );
  }

  if (!episodes.length) {
    return (
      <section className="card empty-library-card">
        <Film size={24} />
        <h2>No combined episodes yet</h2>
        <p>
          Generate the episode clips and press Combine in Generate &amp; Edit. The final
          episode, prompts, and source images will then appear here automatically.
        </p>
        <Link href="/drama-studio" className="primary-button">
          Open Generate &amp; Edit <ArrowRight size={14} />
        </Link>
      </section>
    );
  }

  return (
    <div className="production-info-list">
      <div className="production-info-notice">
        <LockKeyhole size={14} />
        <span>Read-only record · edit prompts and regenerate clips in Generate &amp; Edit.</span>
      </div>
      {episodes.map((episode) => (
        <article className="card production-info-episode" key={`${episode.id}-${episode.createdAt}`}>
          <div className="production-info-head">
            <div>
              <span className="result-label">{episode.project} · Episode {episode.episode}</span>
              <h2>{episode.episodeTitle}</h2>
              <p>
                Combined {formatWorkspaceDateTime(episode.createdAt)} · {episode.scenes.length} clips · {episode.assets.length} images
              </p>
            </div>
            <span className="status-pill ready">Final combined video</span>
          </div>

          <div className="production-info-main-video">
            <video controls playsInline preload="metadata" src={episode.url} />
            <a
              className="secondary-button"
              href={episode.url}
              download={`${episode.project}-episode-${episode.episode}.mp4`}
            >
              <Download size={13} /> Save final MP4
            </a>
          </div>

          <section className="production-info-section">
            <div className="workspace-section-head compact">
              <div>
                <h3>Images used</h3>
                <p>Exact generated references saved when this episode was combined.</p>
              </div>
              <span>{episode.assets.length} assets</span>
            </div>
            <div className="production-info-assets">
              {episode.assets.map((asset, index) => (
                <article key={`${asset.name}-${index}`}>
                  <span
                    className="production-info-asset-image"
                    role="img"
                    aria-label={asset.name}
                    style={{ backgroundImage: `url(${JSON.stringify(asset.resultUrl)})` }}
                  />
                  <div>
                    <span>{asset.type}</span>
                    <h4>{asset.name}</h4>
                    <p>{asset.prompt}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="production-info-section">
            <div className="workspace-section-head compact">
              <div>
                <h3>Clip prompts used</h3>
                <p>Final prompt and model record for every clip in the combined episode.</p>
              </div>
              <span>{episode.scenes.length} prompts</span>
            </div>
            <div className="production-info-prompts">
              {episode.scenes.map((scene) => (
                <article key={scene.id}>
                  <div>
                    <span>{scene.id} · {scene.duration}s</span>
                    <h4>{scene.title}</h4>
                    <small>{scene.provider}</small>
                  </div>
                  <p>{scene.prompt}</p>
                </article>
              ))}
            </div>
          </section>
        </article>
      ))}
    </div>
  );
}

function SettingsContent({
  setToast,
}: {
  setToast: (value: string) => void;
}) {
  const [settings, setSettings] = useState({
    workspaceName: "Semailifezz Studio",
    defaultImageModel: "Seedream 4.5",
    defaultModel: "Seedance 2.0",
    fallbackModel: "Kie Kling 3.0 Standard",
    language: "English",
    autoFallback: true,
    strictReview: true,
    continuity: true,
  });

  useEffect(() => {
    const stored = window.localStorage.getItem(dramaStorageKey("drama-studio:preferences"));
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const timeout = window.setTimeout(
          () => setSettings((current) => ({ ...current, ...parsed })),
          0,
        );
        return () => window.clearTimeout(timeout);
      } catch {
        // Ignore malformed user-side preference data.
      }
    }
  }, []);

  const save = () => {
    window.localStorage.setItem(
      dramaStorageKey("drama-studio:preferences"),
      JSON.stringify(settings),
    );
    const imageModel =
      settings.defaultImageModel === "GPT Image 2"
        ? "gpt-image-2"
        : settings.defaultImageModel === "Qwen2 Image"
          ? "qwen2-image"
          : "seedream-4.5";
    const videoModel =
      settings.defaultModel === "Kie Kling 3.0 Pro"
        ? "kling-3.0"
        : settings.defaultModel === "Kie Kling V3 Turbo"
          ? "kling-v3-turbo"
          : "seedance-2.0";
    window.localStorage.setItem(
      dramaStorageKey("drama-studio:generation-preferences-v1"),
      JSON.stringify({ imageModel, videoModel, videoMode: "pro", videoSound: true }),
    );
    setToast("Workspace preferences saved.");
  };

  return (
    <div className="settings-layout">
      <aside className="settings-nav-card">
        <a href="#workspace" className="active">
          <Settings size={14} /> Workspace
        </a>
        <a href="#generation">
          <Sparkles size={14} /> Generation
        </a>
        <a href="#review">
          <ShieldCheck size={14} /> Review rules
        </a>
        <Link href="/settings/credentials">
          <KeyRound size={14} /> Provider credentials
        </Link>
      </aside>

      <div className="settings-content">
        <section className="card" id="workspace">
          <div className="workspace-section-head">
            <div>
              <h2>Workspace</h2>
              <p>General defaults for every new drama production.</p>
            </div>
          </div>
          <div className="form-grid two">
            <label className="field">
              <span>Workspace name</span>
              <input
                value={settings.workspaceName}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    workspaceName: event.target.value,
                  })
                }
              />
            </label>
            <label className="field">
              <span>Default language</span>
              <select
                value={settings.language}
                onChange={(event) =>
                  setSettings({ ...settings, language: event.target.value })
                }
              >
                <option>English</option>
                <option>Mandarin</option>
                <option>Malay</option>
                <option>Japanese</option>
                <option>Korean</option>
              </select>
            </label>
          </div>
        </section>

        <section className="card" id="generation">
          <div className="workspace-section-head">
            <div>
              <h2>Generation defaults</h2>
              <p>Default Kie AI image and video models across every production page.</p>
            </div>
          </div>
          <div className="form-grid two">
            <label className="field">
              <span>Primary Kie image model</span>
              <select
                value={settings.defaultImageModel}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    defaultImageModel: event.target.value,
                  })
                }
              >
                <option>Seedream 4.5</option>
                <option>GPT Image 2</option>
                <option>Qwen2 Image</option>
              </select>
            </label>
            <label className="field">
              <span>Primary Kie video model</span>
              <select
                value={settings.defaultModel}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    defaultModel: event.target.value,
                  })
                }
              >
                <option>Seedance 2.0</option>
                <option>Kie Kling 3.0 Pro</option>
                <option>Kie Kling V3 Turbo</option>
              </select>
            </label>
          </div>
          <div className="form-grid two">
            <label className="field">
              <span>Fallback Kie video mode</span>
              <select
                value={settings.fallbackModel}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    fallbackModel: event.target.value,
                  })
                }
              >
                <option>Kie Kling 3.0 Standard</option>
                <option>Pause for manual review</option>
              </select>
            </label>
          </div>
          <SettingsToggle
            label="Automatic model fallback"
            detail="Retry a rejected scene with the approved fallback model and log the prompt change."
            checked={settings.autoFallback}
            onChange={(checked) =>
              setSettings({ ...settings, autoFallback: checked })
            }
          />
          <SettingsToggle
            label="Visual continuity lock"
            detail="Attach approved character, venue, and object references to every downstream prompt."
            checked={settings.continuity}
            onChange={(checked) =>
              setSettings({ ...settings, continuity: checked })
            }
          />
        </section>

        <section className="card" id="review">
          <div className="workspace-section-head">
            <div>
              <h2>Review rules</h2>
              <p>Control when the workflow pauses for human approval.</p>
            </div>
          </div>
          <SettingsToggle
            label="Require approval between every step"
            detail="Users must approve each layer before the next production page unlocks."
            checked={settings.strictReview}
            onChange={(checked) =>
              setSettings({ ...settings, strictReview: checked })
            }
          />
        </section>

        <div className="settings-savebar">
          <span>
            Preferences are stored in this browser. Provider secrets use the
            encrypted credential vault.
          </span>
          <button className="primary-button" onClick={save}>
            <Check size={14} /> Save settings
          </button>
        </div>
      </div>
    </div>
  );
}

type CredentialProviderId = "kie";

type CredentialStatus = {
  connected: boolean;
  savedAt?: string;
  fingerprint?: string;
};

const credentialProviderCards: Array<{
  id: CredentialProviderId;
  name: string;
  category: string;
  badge: string;
  tone: string;
  description: string;
  fields: Array<{ key: string; label: string; placeholder: string }>;
}> = [
  {
    id: "kie",
    name: "Kie AI",
    category: "Required for every AI generation stage",
    badge: "K",
    tone: "kie",
    description:
      "One KIE AI Key powers finished briefs, story bibles, asset prompts and images, scene prompts, and Kling 3.0 video tasks.",
    fields: [
      {
        key: "apiKey",
        label: "KIE AI Key",
        placeholder: "Enter your KIE AI Key",
      },
    ],
  },
];

function CredentialsContent({
  setToast,
}: {
  setToast: (value: string) => void;
}) {
  const [statuses, setStatuses] = useState<
    Partial<Record<CredentialProviderId, CredentialStatus>>
  >({});
  const [configured, setConfigured] = useState(true);
  const [values, setValues] = useState<
    Partial<Record<CredentialProviderId, Record<string, string>>>
  >({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/credentials", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then(
        (data: {
          configured?: boolean;
          statuses?: Record<CredentialProviderId, CredentialStatus>;
        }) => {
          setConfigured(Boolean(data.configured));
          if (data.statuses) setStatuses(data.statuses);
        },
      )
      .catch((caught: unknown) => {
        if (
          !(caught instanceof DOMException && caught.name === "AbortError")
        ) {
          setError("Could not read the credential vault.");
        }
      });
    return () => controller.abort();
  }, []);

  const updateValue = (
    provider: CredentialProviderId,
    field: string,
    value: string,
  ) => {
    setValues((current) => ({
      ...current,
      [provider]: {
        ...(current[provider] ?? {}),
        [field]: value,
      },
    }));
  };

  const save = async (provider: CredentialProviderId) => {
    setBusy(`save-${provider}`);
    setError(null);
    try {
      const response = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          credentials: values[provider] ?? {},
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        status?: CredentialStatus;
      };
      if (!response.ok) throw new Error(data.error ?? "Could not save key.");
      if (data.status) {
        setStatuses((current) => ({
          ...current,
          [provider]: data.status,
        }));
      }
      setValues((current) => ({ ...current, [provider]: {} }));
      setToast(
        `${credentialProviderCards.find((item) => item.id === provider)?.name} credential encrypted and saved.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save credential.",
      );
    } finally {
      setBusy(null);
    }
  };

  const verify = async (provider: CredentialProviderId) => {
    setBusy(`verify-${provider}`);
    setError(null);
    try {
      const response = await fetch("/api/credentials/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = (await response.json()) as {
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Vault verification failed.");
      }
      setToast(data.message ?? "Encrypted credential verified.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not verify credential.",
      );
    } finally {
      setBusy(null);
    }
  };

  const remove = async (provider: CredentialProviderId) => {
    setBusy(`remove-${provider}`);
    setError(null);
    try {
      const response = await fetch("/api/credentials", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Could not remove credential.");
      }
      setStatuses((current) => ({
        ...current,
        [provider]: { connected: false },
      }));
      setToast("Provider credential removed from this browser.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not remove credential.",
      );
    } finally {
      setBusy(null);
    }
  };

  const connectedCount = Object.values(statuses).filter(
    (status) => status?.connected,
  ).length;

  return (
    <div className="workspace-page-grid">
      <section className="credential-security-banner">
        <span>
          <LockKeyhole size={18} />
        </span>
        <div>
          <b>Encrypted server-side credential vault</b>
          <p>
            Keys are encrypted with AES-256-GCM and stored in an HTTP-only,
            same-site cookie. They are never placed in localStorage or returned
            to the page after saving.
          </p>
        </div>
        <div className="credential-summary">
          <strong>{connectedCount}</strong>
          <span>of {credentialProviderCards.length} connected</span>
        </div>
      </section>

      {!configured && (
        <section className="credential-config-warning">
          <ShieldCheck size={18} />
          <div>
            <b>Vault encryption key is not configured</b>
            <p>
              Add <code>CREDENTIAL_ENCRYPTION_KEY</code> to the Vercel project
              before saving provider credentials.
            </p>
          </div>
        </section>
      )}

      {error && (
        <section className="credential-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss error">
            <X size={14} />
          </button>
        </section>
      )}

      <section className="credential-grid">
        {credentialProviderCards.map((provider) => {
          const status = statuses[provider.id];
          const providerValues = values[provider.id] ?? {};
          return (
            <article className="credential-card" key={provider.id}>
              <div className="credential-card-head">
                <span className={`credential-provider-mark ${provider.tone}`}>
                  {provider.badge}
                </span>
                <div>
                  <h2>{provider.name}</h2>
                  <span>{provider.category}</span>
                </div>
                <span
                  className={`credential-state ${
                    status?.connected ? "connected" : ""
                  }`}
                >
                  <i />
                  {status?.connected ? "Connected" : "Not connected"}
                </span>
              </div>
              <p className="credential-description">{provider.description}</p>

              {status?.connected ? (
                <div className="saved-credential">
                  <span className="saved-key-icon">
                    <KeyRound size={15} />
                  </span>
                  <div>
                    <b>Credential saved</b>
                    <span>{status.fingerprint}</span>
                    <small>
                      Updated{" "}
                      {status.savedAt
                        ? new Date(status.savedAt).toLocaleString()
                        : "recently"}
                    </small>
                  </div>
                </div>
              ) : (
                <div className="credential-fields">
                  {provider.fields.map((field) => {
                    const visibilityKey = `${provider.id}-${field.key}`;
                    const isVisible = Boolean(visible[visibilityKey]);
                    return (
                      <label className="field" key={field.key}>
                        <span>{field.label}</span>
                        <div className="credential-input">
                          <input
                            type={isVisible ? "text" : "password"}
                            autoComplete="off"
                            value={providerValues[field.key] ?? ""}
                            onChange={(event) =>
                              updateValue(
                                provider.id,
                                field.key,
                                event.target.value,
                              )
                            }
                            placeholder={field.placeholder}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setVisible((current) => ({
                                ...current,
                                [visibilityKey]: !isVisible,
                              }))
                            }
                            aria-label={isVisible ? "Hide value" : "Show value"}
                          >
                            {isVisible ? (
                              <EyeOff size={14} />
                            ) : (
                              <Eye size={14} />
                            )}
                          </button>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}

              <div className="credential-card-actions">
                {status?.connected ? (
                  <>
                    <button
                      className="secondary-button"
                      disabled={busy === `verify-${provider.id}`}
                      onClick={() => verify(provider.id)}
                    >
                      {busy === `verify-${provider.id}` ? (
                        <span className="loading-mark" />
                      ) : (
                        <ShieldCheck size={13} />
                      )}
                      Verify Kie key & credits
                    </button>
                    <button
                      className="danger-button"
                      disabled={busy === `remove-${provider.id}`}
                      onClick={() => remove(provider.id)}
                    >
                      <Trash2 size={13} /> Remove
                    </button>
                  </>
                ) : (
                  <button
                    className="primary-button"
                    disabled={
                      !configured ||
                      provider.fields.some(
                        (field) =>
                          (providerValues[field.key] ?? "").trim().length < 6,
                      ) ||
                      busy === `save-${provider.id}`
                    }
                    onClick={() => save(provider.id)}
                  >
                    {busy === `save-${provider.id}` ? (
                      <span className="loading-mark" />
                    ) : (
                      <LockKeyhole size={13} />
                    )}
                    Encrypt & save
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </section>

      <section className="credential-footnote">
        <ShieldCheck size={16} />
        <div>
          <b>Important security scope</b>
          <p>
            This vault is private to the current browser. For shared,
            account-level credentials, add user authentication and an encrypted
            database or managed secret store.
          </p>
        </div>
      </section>
    </div>
  );
}

function ActivityContent({
  setToast,
}: {
  setToast: (value: string) => void;
}) {
  const rows = [
    ["Scene E01-S04 rerouted to Kling 3.0", "Model fallback", "Today, 9:18 PM"],
    ["Five scene prompts approved", "Step 4", "Today, 9:14 PM"],
    ["Visual continuity pack approved", "Step 3", "Today, 8:52 PM"],
    ["Brass recorder regenerated", "Asset", "Today, 8:47 PM"],
    ["Story Bible Draft 01 approved", "Step 2", "Yesterday, 11:06 PM"],
    ["Creative brief updated", "Step 1", "Yesterday, 10:41 PM"],
  ];

  const exportActivity = () => {
    downloadText(
      "drama-studio-activity.csv",
      [
        "activity,type,time",
        ...rows.map((row) => row.map(csvCell).join(",")),
      ].join("\n"),
    );
    setToast("Activity log exported.");
  };

  return (
    <div className="workspace-page-grid">
      <section className="card workspace-toolbar">
        <div className="filter-tabs">
          <button
            className="active"
            onClick={() => setToast("Showing all workspace activity.")}
          >
            All activity
          </button>
          <button onClick={() => setToast("Generation events selected.")}>
            Generation
          </button>
          <button onClick={() => setToast("Approval events selected.")}>
            Approvals
          </button>
          <button onClick={() => setToast("Credential events selected.")}>
            Credentials
          </button>
        </div>
        <button className="secondary-button" onClick={exportActivity}>
          <Download size={13} /> Export CSV
        </button>
      </section>
      <section className="card activity-page-card">
        <div className="workspace-section-head">
          <div>
            <h2>Workspace audit trail</h2>
            <p>Latest actions across The Last Monsoon.</p>
          </div>
          <span className="count-pill">6 events</span>
        </div>
        <div className="activity-timeline">
          {rows.map(([title, type, time], index) => (
            <article key={title}>
              <span className={`activity-icon activity-${index}`}>
                {index < 2 ? (
                  <Sparkles size={14} />
                ) : index < 5 ? (
                  <CheckCircle2 size={14} />
                ) : (
                  <Settings size={14} />
                )}
              </span>
              <div>
                <b>{title}</b>
                <span>{type}</span>
              </div>
              <time>{time}</time>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function HelpContent() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(0);
  const guides = [
    {
      title: "How the five-step workflow works",
      body: "Each production layer has its own page. Generate, review, edit, and approve the current layer before moving forward. Returning to an earlier page never deletes later work automatically.",
    },
    {
      title: "Choosing one scene, one episode, or all episodes",
      body: "Use the checkboxes on Scene Prompts to choose exact shots. In Generate & Edit, run the next scene for maximum control or the full episode after reviewing the credit estimate.",
    },
    {
      title: "Kie AI and Kling recovery routing",
      body: "All video tasks are submitted to Kling 3.0 through Kie AI. If a scene is rejected or fails, the workspace preserves the original prompt and pauses for your decision before any safety-adjusted retry.",
    },
    {
      title: "Managing API credentials safely",
      body: "The KIE AI Key is submitted only to the server, encrypted, and stored in an HTTP-only cookie. The page receives only connection status and a short fingerprint—not the secret value.",
    },
    {
      title: "FFmpeg episode assembly",
      body: "After all selected scenes are ready, assembly joins clips in scene order, normalizes audio, adds transition handles, and produces an episode master manifest.",
    },
  ];
  const visible = guides.filter((guide) =>
    guide.title.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="help-layout">
      <section className="help-search-card">
        <BookOpen size={22} />
        <h2>What do you need help with?</h2>
        <p>Search the production workflow and provider setup guides.</p>
        <div className="workspace-search large">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search guides"
            aria-label="Search guides"
          />
        </div>
      </section>
      <section className="card help-guides">
        {visible.map((guide, index) => {
          const isOpen = open === index;
          return (
            <article key={guide.title}>
              <button onClick={() => setOpen(isOpen ? -1 : index)}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <b>{guide.title}</b>
                <ChevronDown
                  size={15}
                  className={isOpen ? "rotate" : ""}
                />
              </button>
              {isOpen && <p>{guide.body}</p>}
            </article>
          );
        })}
      </section>
    </div>
  );
}

function SettingsToggle({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="settings-toggle-row">
      <div>
        <b>{label}</b>
        <p>{detail}</p>
      </div>
      <button
        type="button"
        className={`toggle ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}
        aria-label={`Toggle ${label}`}
        aria-pressed={checked}
      >
        <span />
      </button>
    </div>
  );
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
