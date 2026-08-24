import { Suspense } from "react";
import { FolderClient } from "@/components/folder-client";

export default async function FolderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <FolderClient folderId={decodeURIComponent(id)} />
    </Suspense>
  );
}
