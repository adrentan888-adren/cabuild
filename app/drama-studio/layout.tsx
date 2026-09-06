import type { ReactNode } from "react";
import "./drama.css";
import DramaNavigation from "@/components/drama/drama-navigation";

export const metadata = {
  title: "Drama Studio | CABUILD",
  description: "AI episodic drama production inside CABUILD.",
};

export default function DramaStudioLayout({ children }: { children: ReactNode }) {
  return <div className="drama-embedded-root"><DramaNavigation>{children}</DramaNavigation></div>;
}
