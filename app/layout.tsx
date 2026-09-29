import type { Metadata } from "next";
import HistoryGuard from "@/components/history-guard";
import "./globals.css";
import "./workspace-theme.css";
import "./content-creator.css";
import "./insights.css";
import "./settings.css";

export const metadata: Metadata = {
  title: "ContentAgent Social",
  description: "Content intelligence and automation platform"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><HistoryGuard />{children}</body>
    </html>
  );
}
