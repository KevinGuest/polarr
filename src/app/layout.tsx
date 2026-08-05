import type { Metadata } from "next";
import { Toaster } from "sonner";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Polarr",
  description:
    "Self-hosted music discovery, Lidarr requests, and homeserver streaming.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="dark h-full">
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
        <Toaster theme="dark" richColors closeButton position="top-center" />
      </body>
    </html>
  );
}
