import Link from "next/link";
import { PageArtwork } from "@/components/page-intro";

export default function NotFound() {
  return <main className="auth-shell"><section className="auth-card not-found-card"><PageArtwork kind="library" /><span className="welcome-eyebrow">Page not found</span><h1>Find your way back.</h1><p>This address is not available. Return Home to choose a workspace and continue creating.</p><Link href="/" className="primary">Return Home</Link></section></main>;
}
