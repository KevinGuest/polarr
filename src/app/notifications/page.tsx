import { Suspense } from "react";
import { NotificationsClient } from "@/components/notifications-client";

export default function NotificationsPage() {
  return (
    <Suspense fallback={null}>
      <NotificationsClient />
    </Suspense>
  );
}
