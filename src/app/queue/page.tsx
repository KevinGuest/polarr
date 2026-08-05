import { redirect } from "next/navigation";

/** Queue lives in the player side panel — keep this route as a soft redirect. */
export default function QueuePage() {
  redirect("/");
}
