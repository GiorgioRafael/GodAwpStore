import { connection } from "next/server";

import { AppShell } from "@/components/layout/app-shell";
import { requireAdmin } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const identity = await requireAdmin();
  return <AppShell identity={identity}>{children}</AppShell>;
}
