import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { readDb } from "@/lib/store";
import AdminClient from "./AdminClient";
import AdminAccessDenied from "./AdminAccessDenied";

export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const db = await readDb();
  if (!hasPermission(db, user, "admin.access")) return <AdminAccessDenied />;
  return <AdminClient />;
}
