import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Product Video Studio",
  description: "Turn a product image into a scene-based AI video"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
