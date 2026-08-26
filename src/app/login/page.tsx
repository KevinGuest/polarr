import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { discordOAuthConfigured, hasUsers, getSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  if (!hasUsers() || !getSettings().setupComplete) {
    redirect("/setup");
  }
  const discordLoginAvailable = discordOAuthConfigured();
  return (
    <Suspense fallback={null}>
      <LoginForm discordLoginAvailable={discordLoginAvailable} />
    </Suspense>
  );
}
