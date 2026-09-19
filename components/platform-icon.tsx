import { AtSign, Facebook, Instagram, Linkedin, Music2, Youtube, Globe } from "lucide-react";

export default function PlatformIcon({ platform }: { platform: string }) {
  const Icon = { Instagram, Facebook, LinkedIn: Linkedin, TikTok: Music2, YouTube: Youtube, Threads: AtSign }[platform];
  if (platform === "X") return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 4h4l10 16h-4L5 4Zm14 0L5 20" /></svg>;
  return Icon ? <Icon size={18} /> : <Globe size={18} />;
}
