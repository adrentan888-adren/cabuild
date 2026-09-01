"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  BookOpen,
  Box,
  Bug,
  CalendarDays,
  ChevronDown,
  Clapperboard,
  Coins,
  Info,
  LogOut,
  Radar,
  RefreshCcw,
  Settings,
  Sparkles,
  UserRound,
  Wand2,
  WandSparkles,
} from "lucide-react";

export type HeaderWorkspaceMode = "normal" | "drama" | null;

type AccountSummary = {
  user: { name: string; email: string; role: string };
  workspace: { name: string; plan: string; credits: number };
  providers: Array<{
    id: string;
    label: string;
    configured: boolean;
    credits: number | null;
    unit: "credits" | "USD" | null;
    message: string;
  }>;
};

export const normalPages = [
  { id: "persona", label: "Persona", detail: "Voice, audience and brand assets", icon: UserRound },
  { id: "research", label: "Research", detail: "Find proven topics and source content", icon: Radar },
  { id: "create", label: "Create Content", detail: "Turn an idea into a finished asset", icon: Wand2 },
  { id: "publish", label: "My Contents", detail: "Review generation progress and outputs", icon: CalendarDays },
  { id: "automation", label: "Automation", detail: "Schedule repeatable content workflows", icon: RefreshCcw },
  { id: "audit", label: "Social Audit", detail: "Understand connected-account performance", icon: BarChart3 },
  { id: "analyse", label: "Analyze", detail: "Track themes, gaps and performance", icon: Activity },
  { id: "logs", label: "Logs", detail: "Inspect provider jobs and errors", icon: Bug },
] as const;

export const dramaPages = [
  { id: "creative-brief", label: "Creative Brief", detail: "Format, audience and production intent", href: "/drama-studio?step=1", icon: WandSparkles },
  { id: "story-studio", label: "Story Studio", detail: "Story, visual assets and scene prompts", href: "/drama-studio?step=2", icon: BookOpen },
  { id: "generate-edit", label: "Generate & Edit", detail: "Create, review and refine production media", href: "/drama-studio?step=5", icon: Clapperboard },
  { id: "production-info", label: "Production Info", detail: "Final episodes, sources and deliverables", href: "/drama-studio/info", icon: Info },
  { id: "asset-library", label: "Asset Library", detail: "Characters, locations, props and media", href: "/drama-studio/assets", icon: Box },
] as const;

export default function GlobalHeader({
  activeMode,
  activePage,
  initialAccount,
  initialWorkspaceCredits,
  onHomeNavigate,
  onNormalNavigate,
}: {
  activeMode: HeaderWorkspaceMode;
  activePage?: string;
  initialAccount?: { name: string; email: string; role: string };
  initialWorkspaceCredits?: number;
  onHomeNavigate?: () => void;
  onNormalNavigate?: (page: string) => void;
}) {
  const router = useRouter();
  const headerRef = useRef<HTMLDivElement>(null);
  const [openPanel, setOpenPanel] = useState<"normal" | "drama" | "credits" | "account" | null>(null);
  const [suppressedPanel, setSuppressedPanel] = useState<"normal" | "drama" | "credits" | "account" | null>(null);
  const [summary, setSummary] = useState<AccountSummary | null>(
    initialAccount
      ? {
          user: initialAccount,
          workspace: { name: "Content Agent", plan: "", credits: initialWorkspaceCredits ?? 0 },
          providers: [],
        }
      : null,
  );
  const [loadingCredits, setLoadingCredits] = useState(true);

  const refreshCredits = useCallback(async () => {
    setLoadingCredits(true);
    try {
      const response = await fetch("/api/account/credits", { cache: "no-store" });
      if (response.ok) setSummary(await response.json() as AccountSummary);
    } catch {
      // Keep the header and its initial account summary usable while offline.
    } finally {
      setLoadingCredits(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void refreshCredits(), 0);
    return () => window.clearTimeout(timeout);
  }, [refreshCredits]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setOpenPanel(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const hovered = headerRef.current?.querySelector<HTMLElement>("[data-header-panel]:hover")?.dataset.headerPanel as typeof suppressedPanel;
        setOpenPanel((current) => {
          setSuppressedPanel(current ?? hovered ?? null);
          return null;
        });
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const openHome = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!onHomeNavigate) return;
    event.preventDefault();
    onHomeNavigate();
    setOpenPanel(null);
    setSuppressedPanel(null);
  };

  const openNormal = (page: string, event?: React.MouseEvent) => {
    if (!onNormalNavigate) return;
    event?.preventDefault();
    onNormalNavigate(page);
    setOpenPanel(null);
    setSuppressedPanel("normal");
  };
  const panelGroupProps = (panel: "normal" | "drama" | "credits" | "account") => ({
    "data-header-panel": panel,
    onPointerLeave: () => {
      if (suppressedPanel === panel) setSuppressedPanel(null);
    },
  });
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };
  const account = summary?.user ?? initialAccount;
  const workspaceCredits = summary?.workspace.credits ?? initialWorkspaceCredits;
  const initials = (account?.name || "Content Agent")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <div className="global-header" ref={headerRef}>
      <div className="global-header-inner">
        <Link href="/" className="global-brand" aria-label="Content Agent home" onClick={openHome}>
          <span className="global-brand-logo"><Sparkles size={17} /></span>
          <span className="global-brand-copy">
            <b>Content Agent</b>
            <small>AI content operations</small>
          </span>
        </Link>

        <nav className="global-workspace-nav" aria-label="Content Agent workspaces">
          <div {...panelGroupProps("normal")} className={`global-nav-group ${openPanel === "normal" ? "open" : ""} ${suppressedPanel === "normal" ? "suppress-hover" : ""}`}>
            <div className={`global-nav-trigger ${activeMode === "normal" ? "active" : ""}`}>
              <Link href="/?view=persona" onClick={(event) => openNormal("persona", event)}>
                <Wand2 size={15} /> Normal Content
              </Link>
              <button type="button" aria-label="Show Normal Content pages" aria-expanded={openPanel === "normal"} onClick={() => setOpenPanel(openPanel === "normal" ? null : "normal")}>
                <ChevronDown size={13} />
              </button>
            </div>
            <div className="global-nav-menu normal-menu" role="menu">
              <div className="global-menu-heading"><span>Normal Content</span><small>Content workflow and operations</small></div>
              <div className="global-menu-grid">
                {normalPages.map(({ id, label, detail, icon: Icon }) => (
                  <Link key={id} href={`/?view=${id}`} className={`global-menu-item ${activeMode === "normal" && activePage === id ? "active" : ""}`} onClick={(event) => openNormal(id, event)} role="menuitem">
                    <span><Icon size={14} /></span><span><b>{label}</b><small>{detail}</small></span>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <div {...panelGroupProps("drama")} className={`global-nav-group ${openPanel === "drama" ? "open" : ""} ${suppressedPanel === "drama" ? "suppress-hover" : ""}`}>
            <div className={`global-nav-trigger ${activeMode === "drama" ? "active" : ""}`}>
              <Link href="/drama-studio?step=1" onClick={() => { setOpenPanel(null); setSuppressedPanel("drama"); }}><Clapperboard size={15} /> Drama Studio</Link>
              <button type="button" aria-label="Show Drama Studio pages" aria-expanded={openPanel === "drama"} onClick={() => setOpenPanel(openPanel === "drama" ? null : "drama")}>
                <ChevronDown size={13} />
              </button>
            </div>
            <div className="global-nav-menu drama-menu" role="menu">
              <div className="global-menu-heading"><span>Drama Studio</span><small>From brief to production library</small></div>
              <div className="global-menu-grid one-column">
                {dramaPages.map(({ id, label, detail, href, icon: Icon }) => (
                  <Link key={id} href={href} className={`global-menu-item ${activeMode === "drama" && activePage === id ? "active" : ""}`} onClick={() => { setOpenPanel(null); setSuppressedPanel("drama"); }} role="menuitem">
                    <span><Icon size={14} /></span><span><b>{label}</b><small>{detail}</small></span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </nav>

        <div className="global-header-actions">
          <div {...panelGroupProps("credits")} className={`global-action-group ${openPanel === "credits" ? "open" : ""} ${suppressedPanel === "credits" ? "suppress-hover" : ""}`}>
            <button type="button" className="global-credit-trigger" aria-expanded={openPanel === "credits"} onClick={() => setOpenPanel(openPanel === "credits" ? null : "credits")}>
              <Coins size={15} />
              <span className="global-action-label"><b>{workspaceCredits ?? "—"}</b> CA credits</span>
              <ChevronDown size={12} />
            </button>
            <div className="global-popover credit-popover">
              <div className="global-popover-head">
                <div><b>Credits &amp; API balances</b><small>Live balances where provider APIs support them</small></div>
                <button type="button" onClick={() => void refreshCredits()} aria-label="Refresh credit balances"><RefreshCcw size={13} /></button>
              </div>
              <div className="credit-provider-list">
                <div className="credit-provider-row primary-balance"><span><b>Content Agent</b><small>{summary?.workspace.plan || "Workspace balance"}</small></span><strong>{workspaceCredits ?? "—"} CA</strong></div>
                {summary?.providers.map((provider) => (
                  <div className="credit-provider-row" key={provider.id}>
                    <span><b>{provider.label}</b><small>{provider.message}</small></span>
                    <strong className={provider.configured ? "connected" : "unavailable"}>
                      {provider.credits !== null
                        ? provider.unit === "USD"
                          ? `$${provider.credits.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : `${provider.credits.toLocaleString()} credits`
                        : provider.configured ? "Connected" : "Not connected"}
                    </strong>
                  </div>
                ))}
                {loadingCredits && !summary?.providers.length ? <div className="popover-loading">Checking provider balances…</div> : null}
              </div>
            </div>
          </div>

          <div {...panelGroupProps("account")} className={`global-action-group ${openPanel === "account" ? "open" : ""} ${suppressedPanel === "account" ? "suppress-hover" : ""}`}>
            <button type="button" className="global-account-trigger" aria-label="Open account menu" aria-expanded={openPanel === "account"} onClick={() => setOpenPanel(openPanel === "account" ? null : "account")}>
              <span className="global-account-avatar">{initials || "CA"}</span>
              <span className="global-action-label"><b>{account?.name || "Account"}</b><small>{account?.role || "Workspace user"}</small></span>
              <ChevronDown size={12} />
            </button>
            <div className="global-popover account-popover">
              <div className="account-summary"><span className="global-account-avatar large">{initials || "CA"}</span><span><b>{account?.name || "Content Agent user"}</b><small>{account?.email || "Signed-in account"}</small></span></div>
              <Link href="/?view=persona" onClick={(event) => openNormal("persona", event)}><UserRound size={14} /> Persona</Link>
              <Link href="/?view=settings" onClick={(event) => openNormal("settings", event)}><Settings size={14} /> Settings</Link>
              <button type="button" onClick={() => void logout()}><LogOut size={14} /> Log out</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
