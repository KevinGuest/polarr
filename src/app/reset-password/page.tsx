import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { hasUsers, getSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  if (!hasUsers() || !getSettings().setupComplete) {
    redirect("/setup");
  }
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
