import type { ReactNode } from "react";
import { Clapperboard, FileText, FolderOpen, Radar, Settings2, ShieldCheck, Sparkles, UserRound } from "lucide-react";

export type PageArt = "identity" | "research" | "create" | "library" | "story" | "operations" | "admin" | "text";

export function PageArtwork({ kind = "create" }: { kind?: PageArt }) {
  const Icon = { identity: UserRound, research: Radar, create: Sparkles, library: FolderOpen, story: Clapperboard, operations: Settings2, admin: ShieldCheck, text: FileText }[kind];
  return <div className={`page-artwork ${kind}`} aria-hidden="true">
    <svg viewBox="0 0 190 130" fill="none">
      <ellipse cx="95" cy="70" rx="88" ry="54" stroke="currentColor" strokeDasharray="3 6" opacity=".23" />
      <rect x="35" y="18" width="98" height="88" rx="12" transform="rotate(-12 84 62)" fill="var(--art-paper)" stroke="var(--art-line)" />
      <rect x="61" y="27" width="98" height="88" rx="12" transform="rotate(9 110 71)" fill="var(--art-surface)" stroke="var(--art-line)" />
      <path d="M83 93h51M83 101h33" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".35" />
      <path d="m34 34 3 9 10 3-10 3-3 9-3-9-9-3 9-3Z" fill="currentColor" opacity=".6" />
      <circle cx="164" cy="99" r="5" fill="currentColor" opacity=".25" />
    </svg>
    <span><Icon size={29} strokeWidth={1.5} /></span>
  </div>;
}

export default function PageIntro({ title, description, eyebrow = "Content Creator", tone = "lilac", art = "create", children }: {
  title: string; description: string; eyebrow?: string; tone?: "sage" | "lilac" | "slate"; art?: PageArt; children?: ReactNode;
}) {
  return <section className={`page-intro theme-${tone}`} aria-label={`${title} introduction`}>
    <div className="page-intro-copy"><span className="page-intro-kicker">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
    <PageArtwork kind={art} />
    {children ? <div className="page-intro-tools">{children}</div> : null}
  </section>;
}
