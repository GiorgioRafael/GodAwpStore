import { connection } from "next/server";

import { MasterAdminShell } from "@/components/platform/master-admin-shell";
import { requireAdmin } from "@/lib/auth";

export default async function DiscordBotsAdminLayout({ children }: LayoutProps<"/admin/discordbots">) {
  await connection();
  const identity = await requireAdmin();
  return <MasterAdminShell identity={identity}>{children}</MasterAdminShell>;
}
