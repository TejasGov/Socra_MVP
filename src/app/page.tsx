import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/current-user";
import { homePathFor } from "@/server/auth/rbac";

export default async function RootPage() {
  const user = await getCurrentUser();
  redirect(user ? homePathFor(user) : "/login");
}
