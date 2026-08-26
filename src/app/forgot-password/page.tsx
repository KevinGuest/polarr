import { redirect } from "next/navigation";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { hasUsers, getSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  if (!hasUsers() || !getSettings().setupComplete) {
    redirect("/setup");
  }
  return <ForgotPasswordForm />;
}
