"use client";

import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import { Box, Bug, Clapperboard, Wand2 } from "lucide-react";
import { dramaPages, normalPages, type HeaderWorkspaceMode } from "@/components/global-header";
import "./workspace-rail.css";

export default function WorkspaceRail({ mode, activePage, onNormalNavigate }: {
  mode: Exclude<HeaderWorkspaceMode, null>;
  activePage?: string;
  onNormalNavigate?: (page: string) => void;
}) {
  const isNormal = mode === "normal";
  const pages = isNormal ? normalPages.filter(page => page.id !== "logs") : dramaPages.filter(page => page.id !== "asset-library");
  const ModeIcon = isNormal ? Wand2 : Clapperboard;
  const navRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const nav = navRef.current, indicator = indicatorRef.current;
    if (!nav || !indicator) return;
    const key = `workspace-tab-position:${mode}`;
    let frame = 0;
    const measure = () => {
      const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active) { indicator.hidden = true; return; }
      const rect = { x: active.offsetLeft, y: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight };
      const paint = (position: typeof rect) => {
        indicator.style.transform = `translate(${position.x}px, ${position.y}px)`;
        indicator.style.width = `${position.width}px`;
        indicator.style.height = `${position.height}px`;
      };
      if (indicator.hidden) {
        try {
          const previous = JSON.parse(sessionStorage.getItem(key) || 'null');
          if (previous && previous.viewport === window.innerWidth) paint(previous);
          else paint(rect);
        } catch { paint(rect); }
        indicator.hidden = false;
        indicator.getBoundingClientRect();
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => paint(rect));
      try { sessionStorage.setItem(key, JSON.stringify({ ...rect, viewport: window.innerWidth })); } catch { /* Navigation also works without browser storage. */ }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [activePage, mode]);

  return <div className="workspace-navigation-group"><aside className={`workspace-navigation ${isNormal ? "normal-navigation" : "drama-navigation"}`} aria-label={`${isNormal ? "Content Creator" : "Drama Studio"} section navigation`}>
    <div className="workspace-navigation-heading"><span className="workspace-rail-icon"><ModeIcon size={15} /></span><span className="workspace-navigation-label">{isNormal ? "Content Creator" : "Drama Studio"}</span></div>
    <nav ref={navRef}>
      <span className="workspace-tab-indicator" ref={indicatorRef} hidden aria-hidden="true" />
      {pages.map(page => {
        const Icon = page.icon;
        const active = activePage === page.id;
        const href = "href" in page ? page.href : `/?view=${page.id}`;
        return <Link key={page.id} href={href} className={`workspace-navigation-item ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} title={page.label} onClick={isNormal && onNormalNavigate ? event => { event.preventDefault(); onNormalNavigate(page.id); } : undefined}>
          <span className="workspace-rail-icon"><Icon size={15} /></span><span className="workspace-navigation-label">{page.label}</span>
        </Link>;
      })}
    </nav>
  </aside>
    {isNormal ? <div className="workspace-library-tools">
      <Link href="/?view=logs" className={`workspace-library-button ${activePage === "logs" ? "active" : ""}`} aria-current={activePage === "logs" ? "page" : undefined} onClick={onNormalNavigate ? event => { event.preventDefault(); onNormalNavigate("logs"); } : undefined}>
        <Bug size={17} /><span>Logs</span>
      </Link>
    </div> : <div className="workspace-library-tools">
      <Link href="/drama-studio/assets" className={`workspace-library-button ${activePage === "asset-library" ? "active" : ""}`} aria-current={activePage === "asset-library" ? "page" : undefined}>
        <Box size={17} /><span>Asset Library</span>
      </Link>
    </div>}
  </div>;
}
