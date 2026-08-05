"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { albumHref } from "@/lib/album-ref";

/** Legacy /album?title=&artist= → /album/{opaqueId} */
function LegacyAlbumRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const title = searchParams.get("title") || "";
    const artist = searchParams.get("artist") || "";
    const foreignAlbumId = searchParams.get("foreignAlbumId") || undefined;
    const lidarrRaw = searchParams.get("lidarrAlbumId");
    const lidarrAlbumId = lidarrRaw ? Number.parseInt(lidarrRaw, 10) : undefined;
    if (!title && !artist && !foreignAlbumId && !lidarrAlbumId) {
      router.replace("/");
      return;
    }
    router.replace(
      albumHref({
        title,
        artist,
        foreignAlbumId,
        lidarrAlbumId:
          lidarrAlbumId != null && Number.isFinite(lidarrAlbumId)
            ? lidarrAlbumId
            : undefined,
      }),
    );
  }, [router, searchParams]);

  return null;
}

export default function LegacyAlbumPage() {
  return (
    <Suspense fallback={null}>
      <LegacyAlbumRedirect />
    </Suspense>
  );
}
