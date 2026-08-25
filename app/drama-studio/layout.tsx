import type { ReactNode } from "react";
import "./drama.css";

export const metadata = {
  title: "Drama Studio | CABUILD",
  description: "AI episodic drama production inside CABUILD.",
};

export default function DramaStudioLayout({ children }: { children: ReactNode }) {
  return <div className="drama-embedded-root">{children}</div>;
}
