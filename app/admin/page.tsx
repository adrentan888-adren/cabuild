import { redirect } from "next/navigation";
import { currentUser, isAdminRole } from "@/lib/session";
import AdminClient from "./AdminClient";

export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!isAdminRole(user.role)) redirect("/");
  return <AdminClient />;
}
