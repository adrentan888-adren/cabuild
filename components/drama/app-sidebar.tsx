"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Box,
  ChevronDown,
  Clapperboard,
  Info,
  MoreHorizontal,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";

export type DramaNavigationPage =
  | "creative-brief"
  | "story-studio"
  | "generate-edit"
  | "production-info"
  | "asset-library";

const dramaSteps = [
  { id: "creative-brief", href: "/drama-studio?step=1", step: 1, label: "Creative Brief", detail: "Set format, audience and production intent", icon: WandSparkles },
  { id: "story-studio", href: "/drama-studio?step=2", step: 2, label: "Story Studio", detail: "Develop story, visual assets and scene prompts", icon: BookOpen },
  { id: "generate-edit", href: "/drama-studio?step=5", step: 5, label: "Generate & Edit", detail: "Create, review and refine production media", icon: Clapperboard },
] as const;

export default function AppSidebar({
  open,
  onClose,
  title = "The Last Monsoon",
  episodes = 8,
  activePage,
  onSelectWorkflow,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  episodes?: number;
  activePage?: DramaNavigationPage;
  onSelectWorkflow?: (step: 1 | 2 | 5) => void;
}) {
  const pathname = usePathname();
  const resolvedActivePage =
    activePage ??
    (pathname === "/drama-studio/assets"
      ? "asset-library"
      : pathname === "/drama-studio/info"
        ? "production-info"
        : "creative-brief");

  return (
    <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
      <div className="brand-block">
        <div className="brand-symbol">
          <Clapperboard size={17} />
        </div>
        <div>
          <div className="brand-name">Drama Studio</div>
          <div className="brand-sub">AI production workspace</div>
        </div>
        <button className="mobile-close" onClick={onClose} aria-label="Close menu">
          <X size={16} />
        </button>
      </div>

      <div className="sidebar-project">
        <div className="eyebrow">Current production</div>
        <Link href="/drama-studio" className="project-switch">
          <span className="project-avatar">{initials(title)}</span>
          <span>
            <b>{title || "Untitled drama"}</b>
            <small>Draft · {episodes} episodes</small>
          </span>
          <ChevronDown size={14} />
        </Link>
      </div>

      <nav className="main-nav studio-navigation" aria-label="Primary">
        <div className="studio-nav-section-label">Production workflow</div>
        <div className="studio-nav-list" aria-label="Drama production workflow">
          {dramaSteps.map(({ id, href, step, label, detail, icon: Icon }, index) => (
            <Link
              href={href}
              key={id}
              className={`studio-nav-item ${resolvedActivePage === id ? "active" : ""}`}
              aria-current={resolvedActivePage === id ? "page" : undefined}
              onClick={(event) => {
                if (onSelectWorkflow) {
                  event.preventDefault();
                  onSelectWorkflow(step);
                }
                onClose();
              }}
            >
              <span className="studio-nav-step">{String(index + 1).padStart(2, "0")}</span>
              <span className="studio-nav-copy">
                <b className="studio-nav-label"><Icon size={13} />{label}</b>
                <small className="studio-nav-detail">{detail}</small>
              </span>
            </Link>
          ))}
          <Link
            href="/drama-studio/info"
            className={`studio-nav-item ${resolvedActivePage === "production-info" ? "active" : ""}`}
            aria-current={resolvedActivePage === "production-info" ? "page" : undefined}
            onClick={onClose}
          >
            <span className="studio-nav-step">04</span>
            <span className="studio-nav-copy">
              <b className="studio-nav-label"><Info size={13} />Production Info</b>
              <small className="studio-nav-detail">Review final episodes, sources and deliverables</small>
            </span>
          </Link>
        </div>

        <div className="studio-nav-section-label secondary">Insights &amp; Operations</div>
        <Link
          href="/drama-studio/assets"
          className={`studio-nav-item ${resolvedActivePage === "asset-library" ? "active" : ""}`}
          aria-current={resolvedActivePage === "asset-library" ? "page" : undefined}
          onClick={onClose}
        >
          <span className="studio-nav-step"><Box size={13} /></span>
          <span className="studio-nav-copy">
            <b className="studio-nav-label">Asset Library</b>
            <small className="studio-nav-detail">Characters, locations, props and media</small>
          </span>
        </Link>
      </nav>

      <div className="sidebar-flex-spacer" />
      <div className="sidebar-footer compact-sidebar-footer">
        <Link href="/drama-studio" className="workspace-profile">
          <span className="profile-avatar"><Sparkles size={13} /></span>
          <span>
            <b>Semailifezz Studio</b>
            <small>Workspace settings</small>
          </span>
          <MoreHorizontal size={15} />
        </Link>
      </div>
    </aside>
  );
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((part) => part[0]).join("") || "DR").toUpperCase();
}
