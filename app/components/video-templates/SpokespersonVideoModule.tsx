"use client";

import { ExternalLink, Mic, UserRound } from "lucide-react";

const avatarFlowUrl = (process.env.NEXT_PUBLIC_AVATARFLOW_URL || "").replace(/\/+$/, "");

export default function SpokespersonVideoModule({ active }: { active: boolean }) {
  if (!avatarFlowUrl) {
    return <section className={`spokesperson-empty ${active ? "active" : "inactive"}`}><UserRound size={30} /><div><span className="staging-badge">Staging</span><h2>Spokesperson Video</h2><p>The AvatarFlow staging URL is not configured. Set <code>NEXT_PUBLIC_AVATARFLOW_URL</code> in the CABuild staging environment.</p></div></section>;
  }

  return <div className={`spokesperson-module ${active ? "active" : "inactive"}`} aria-hidden={!active}>
    <header className="spokesperson-head">
      <div><div className="spokesperson-kicker"><span className="staging-badge">Staging</span><span>Video Template</span></div><h2>Spokesperson Video</h2><p>Create a presenter-led video using a face image and uploaded, recorded, or generated speech.</p></div>
      <a className="primary spokesperson-open" href={avatarFlowUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Open in new tab</a>
    </header>
    <div className="spokesperson-notice"><Mic size={16} /><span>Microphone access is enabled for the embedded recorder. If your browser blocks recording inside the page, use <b>Open in new tab</b>.</span></div>
    <div className="spokesperson-security"><b>Temporary staging limitation:</b> AvatarFlow staging is a separate public service. CABuild login does not yet protect its jobs or establish user ownership.</div>
    <div className="spokesperson-frame-wrap">
      <iframe title="Spokesperson Video" src={avatarFlowUrl} allow="microphone; clipboard-write; fullscreen" referrerPolicy="strict-origin-when-cross-origin" className="spokesperson-frame" />
    </div>
  </div>;
}
