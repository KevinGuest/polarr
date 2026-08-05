import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { hasUsers, getSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  if (!hasUsers() || !getSettings().setupComplete) {
    redirect("/setup");
  }
  return <LoginForm />;
}
