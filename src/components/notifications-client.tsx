"use client";

import { useEffect } from "react";
import {
  NotificationsList,
  useNotifications,
} from "@/components/admin-error-notifications";

export function NotificationsClient() {
  const { items, markAllRead } = useNotifications();

  useEffect(() => {
    void markAllRead();
  }, [markAllRead]);

  return (
    <div className="min-w-0 lg:max-w-2xl">
      <h1 className="mb-4 hidden text-2xl font-bold text-foreground lg:block">
        Notifications
      </h1>
      <NotificationsList items={items} />
    </div>
  );
}
