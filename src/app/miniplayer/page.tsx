import type { Metadata } from "next";
import { MiniplayerClient } from "@/components/miniplayer-client";

export const metadata: Metadata = {
  title: "Polarr Miniplayer",
  description: "Compact Polarr player window",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function MiniplayerPage() {
  return <MiniplayerClient />;
}
