import { Suspense } from "react";
import { AdminUsersClient } from "@/components/admin-users-client";

export default function AdminUsersPage() {
  return (
    <Suspense fallback={null}>
      <AdminUsersClient />
    </Suspense>
  );
}
