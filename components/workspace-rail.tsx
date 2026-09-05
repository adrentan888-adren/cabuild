"use client";

import Link from "next/link";
import { Clapperboard, Wand2 } from "lucide-react";
import { dramaPages, normalPages, type HeaderWorkspaceMode } from "@/components/global-header";

export default function WorkspaceRail({
  mode,
  activePage,
  onNormalNavigate,
}: {
  mode: Exclude<HeaderWorkspaceMode, null>;
  activePage?: string;
  onNormalNavigate?: (page: string) => void;
}) {
  const isNormal = mode === "normal";
  const pages = isNormal ? normalPages : dramaPages;
  const ModeIcon = isNormal ? Wand2 : Clapperboard;

  return (
    <aside
      className="workspace-navigation"
      aria-label={`${isNormal ? "Normal Content" : "Drama Studio"} section navigation`}
    >
      <div className="workspace-navigation-heading">
        <span className="workspace-rail-icon"><ModeIcon size={15} /></span>
        <span className="workspace-navigation-label">{isNormal ? "Normal Content" : "Drama Studio"}</span>
      </div>
      <nav>
        {pages.map((page) => {
          const Icon = page.icon;
          const active = activePage === page.id;
          const href = "href" in page ? page.href : `/?view=${page.id}`;
          return (
            <Link
              key={page.id}
              href={href}
              className={`workspace-navigation-item ${active ? "active" : ""}`}
              aria-current={active ? "page" : undefined}
              title={page.label}
              onClick={
                isNormal && onNormalNavigate
                  ? (event) => {
                      event.preventDefault();
                      onNormalNavigate(page.id);
                    }
                  : undefined
              }
            >
              <span className="workspace-rail-icon"><Icon size={15} /></span>
              <span className="workspace-navigation-label">{page.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
