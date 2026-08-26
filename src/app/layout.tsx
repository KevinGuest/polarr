import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/app-shell";
import { AppToaster } from "@/components/app-toaster";
import "./globals.css";

export const metadata: Metadata = {
  title: "Polarr",
  description:
    "Self-hosted music discovery, Lidarr requests, and homeserver streaming.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0c0b12",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="dark h-full">
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
        <AppToaster />
      </body>
    </html>
  );
}
