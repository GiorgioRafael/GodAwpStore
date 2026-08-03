import { connection } from "next/server";

import { MasterAdminShell } from "@/components/platform/master-admin-shell";
import { requireMasterAdmin } from "@/lib/master-auth-session";

export default async function DiscordBotsAdminLayout({ children }: LayoutProps<"/admin/discordbots">) {
  await connection();
  const identity = await requireMasterAdmin();
  return <MasterAdminShell identity={identity}>{children}</MasterAdminShell>;
}
