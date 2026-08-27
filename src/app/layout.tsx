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
  themeColor: "#09090b",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="dark h-full" suppressHydrationWarning>
      <body className="min-h-full">
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var on=false;try{on=new URLSearchParams(location.search).get("desktop")==="1";}catch(e){}try{on=on||sessionStorage.getItem("polarr-desktop")==="1";}catch(e){}try{on=on||!!(window.__POLARR_DESKTOP__);}catch(e){}if(!on)return;document.documentElement.dataset.polarrDesktop="1";document.documentElement.setAttribute("data-polarr-desktop","1");try{sessionStorage.setItem("polarr-desktop","1");}catch(e){}var id="polarr-desktop-hide-header";if(!document.getElementById(id)){var s=document.createElement("style");s.id=id;s.textContent="html[data-polarr-desktop] [data-polarr-app-header]{display:none!important;height:0!important;max-height:0!important;min-height:0!important;overflow:hidden!important;border:0!important;padding:0!important;margin:0!important;visibility:hidden!important;pointer-events:none!important;}";(document.body||document.documentElement).appendChild(s);}}catch(e){}})();`,
          }}
        />
        <AppShell>{children}</AppShell>
        <AppToaster />
      </body>
    </html>
  );
}
