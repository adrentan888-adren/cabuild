"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Box,
  ChevronDown,
  Clapperboard,
  LayoutDashboard,
  Info,
  MoreHorizontal,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";

const dramaSteps = [
  { href: "/drama-studio", label: "Creative Brief", detail: "Set format, audience and production intent", icon: WandSparkles },
  { href: "/drama-studio", label: "Story Studio", detail: "Develop story structure and scene prompts", icon: BookOpen },
  { href: "/drama-studio", label: "Generate & Edit", detail: "Create, review and refine production media", icon: Clapperboard },
  { href: "/drama-studio", label: "Production Info", detail: "Review status, costs and deliverables", icon: Info },
] as const;

export default function AppSidebar({
  open,
  onClose,
  title = "The Last Monsoon",
  episodes = 8,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  episodes?: number;
}) {
  const pathname = usePathname();
  const inDrama =
    pathname.startsWith("/drama-studio") && pathname !== "/drama-studio/assets";

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
        <Link
          href="/drama-studio"
          className={`nav-link drama-root-link ${inDrama ? "active" : ""}`}
        >
          <span className="nav-icon"><LayoutDashboard size={15} /></span>
          <span className="nav-link-copy"><b>Drama Studio</b><small>Brief, story, scenes and production</small></span>
        </Link>

        <div className="drama-subnav" aria-label="Drama production workflow">
          <div className="drama-nav-label">Production workflow</div>
          {dramaSteps.map(({ href, label, detail, icon: Icon }) => (
            <Link
              href={href}
              key={label}
              className="drama-subnav-link"
              onClick={onClose}
            >
              <Icon size={13} />
              <span className="nav-link-copy"><b>{label}</b><small>{detail}</small></span>
            </Link>
          ))}
        </div>

        <Link
          href="/drama-studio/assets"
          className={`nav-link ${pathname === "/drama-studio/assets" ? "active" : ""}`}
        >
          <span className="nav-icon"><Box size={15} /></span>
          <span className="nav-link-copy"><b>Asset Library</b><small>Characters, locations, props and media</small></span>
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
