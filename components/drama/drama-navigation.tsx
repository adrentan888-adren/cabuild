"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import GlobalHeader, { dramaPages } from "@/components/global-header";
import WorkspaceRail from "@/components/workspace-rail";
import PageIntro from "@/components/page-intro";

export function DramaPageLoading({ href }: { href?: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const currentHref = pathname === "/drama-studio" ? `${pathname}?step=${search.get("step") || 1}` : pathname;
  const page = dramaPages.find(page => page.href === (href || currentHref)) || dramaPages[0];
  return <div className="app-shell drama-loading-shell"><main className="main"><header className="topbar"><GlobalHeader activeMode="drama" activePage={page.id} /></header><div className="workspace-content-frame drama-workspace-frame"><WorkspaceRail mode="drama" activePage={page.id} /><div className="main-panel" aria-busy="true"><PageIntro title={page.label} description={page.detail} eyebrow="Drama Studio" tone="lilac" art={page.id === "asset-library" ? "library" : "story"} /><section className="drama-loading-card" role="status"><LoaderCircle size={26} /><div><h2>Loading {page.label}</h2><p>Bringing your saved work into view…</p></div></section><div className="drama-loading-skeleton" aria-hidden="true"><span /><span /><span /></div></div></div></main></div>;
}

export default function DramaNavigation({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [destination, setDestination] = useState<string | null>(null);
  useEffect(() => { setDestination(null); }, [pathname]);
  useEffect(() => { if (!isPending) setDestination(null); }, [isPending]);
  useEffect(() => {
    const restoreHistory = () => {
      if (!destination) return;
      setDestination(null);
      // Supersede the outstanding route request so a late result cannot replace Back.
      startTransition(() => router.replace(window.location.pathname + window.location.search, { scroll: false }));
    };
    window.addEventListener("popstate", restoreHistory);
    return () => window.removeEventListener("popstate", restoreHistory);
  }, [destination, router]);
  return <div className="drama-navigation-surface" onClickCapture={event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
    if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin || !/^\/drama-studio(?:\/|$)/.test(url.pathname)) return;
    const href = url.pathname + url.search;
    const detail = { href, handled: false };
    window.dispatchEvent(new CustomEvent("drama:navigate", { detail }));
    event.preventDefault();
    if (detail.handled) {
      if (destination) startTransition(() => router.push(href));
      setDestination(null);
      return;
    }
    if (href === window.location.pathname + window.location.search && !destination) return;
    setDestination(href);
    startTransition(() => router.push(href));
  }}>
    <div hidden={Boolean(destination)}>{children}</div>
    {destination && <DramaPageLoading href={destination} />}
  </div>;
}
