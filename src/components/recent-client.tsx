"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePlayer } from "@/components/player-provider";

/** Legacy /recent route — opens the queue panel on Recently played. */
export function RecentClient() {
  const router = useRouter();
  const { openQueue } = usePlayer();

  useEffect(() => {
    openQueue("recent");
    router.replace("/");
  }, [openQueue, router]);

  return (
    <p className="text-sm text-muted-foreground">Opening recently played…</p>
  );
}
