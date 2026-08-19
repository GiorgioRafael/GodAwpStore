import { connection } from "next/server";

import { MasterAdminShell } from "@/components/platform/master-admin-shell";
import { requireMasterAdmin } from "@/lib/master-auth-session";

/**
 * A casca de todas as abas do painel mestre.
 *
 * Cobre `/admin` e tudo abaixo dela, inclusive a URL antiga `/admin/discordbots`,
 * então a sessão Google é exigida uma vez só, aqui.
 */
export default async function MasterAdminLayout({ children }: LayoutProps<"/admin">) {
  await connection();
  const identity = await requireMasterAdmin();
  return <MasterAdminShell identity={identity}>{children}</MasterAdminShell>;
}
