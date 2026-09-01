"use client";

import Link from "next/link";
import { Clapperboard, House, Sparkles } from "lucide-react";

export type WorkspaceMode = "normal" | "drama" | null;

export default function WorkspaceModeSwitcher({
  activeMode,
  onHome,
  onNormal,
}: {
  activeMode: WorkspaceMode;
  onHome?: () => void;
  onNormal?: () => void;
}) {
  const normalClass = `workspace-mode-tab ${activeMode === "normal" ? "active" : ""}`;

  return (
    <nav className="workspace-mode-switcher" aria-label="Choose workspace">
      {onHome ? (
        <button type="button" className="workspace-home-link" onClick={onHome} aria-label="Open Home" title="Home">
          <House size={15} />
        </button>
      ) : (
        <Link className="workspace-home-link" href="/" aria-label="Open Home" title="Home">
          <House size={15} />
        </Link>
      )}
      {onNormal ? (
        <button type="button" className={normalClass} onClick={onNormal}>
          <Sparkles size={14} />
          <span>Normal Content</span>
        </button>
      ) : (
        <Link className={normalClass} href="/?view=persona">
          <Sparkles size={14} />
          <span>Normal Content</span>
        </Link>
      )}
      <Link className={`workspace-mode-tab ${activeMode === "drama" ? "active" : ""}`} href="/drama-studio">
        <Clapperboard size={14} />
        <span>Drama Studio</span>
      </Link>
    </nav>
  );
}
