import { redirect } from "next/navigation";
import { SetupWizard } from "@/components/setup-wizard";
import { getSettings, hasUsers } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function SetupPage() {
  const settings = getSettings();
  if (settings.setupComplete && hasUsers()) {
    redirect("/login");
  }
  return <SetupWizard />;
}
