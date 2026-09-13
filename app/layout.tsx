import type { Metadata } from "next";
import "./globals.css";
import "./workspace-theme.css";
import "./content-creator.css";

export const metadata: Metadata = {
  title: "ContentAgent Social",
  description: "Content intelligence and automation platform"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
