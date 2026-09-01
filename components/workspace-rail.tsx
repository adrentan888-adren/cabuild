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
      className={`workspace-rail ${isNormal ? "normal-rail" : "drama-rail"}`}
      aria-label={`${isNormal ? "Normal Content" : "Drama Studio"} section navigation`}
    >
      <div className="workspace-rail-heading">
        <span className="workspace-rail-icon"><ModeIcon size={15} /></span>
        <span className="workspace-rail-label">{isNormal ? "Normal Content" : "Drama Studio"}</span>
      </div>
      <nav>
        {pages.map((page, index) => {
          const Icon = page.icon;
          const active = activePage === page.id;
          const href = "href" in page ? page.href : `/?view=${page.id}`;
          return (
            <Link
              key={page.id}
              href={href}
              className={`workspace-rail-item ${active ? "active" : ""} ${isNormal && index === 5 ? "rail-section-start" : ""}`}
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
              <span className="workspace-rail-label">{page.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
