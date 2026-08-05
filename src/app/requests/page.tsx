import { redirect } from "next/navigation";

export default function RequestsRedirect() {
  redirect("/admin/requests");
}
