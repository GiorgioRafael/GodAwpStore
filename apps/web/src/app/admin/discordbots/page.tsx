import type { Metadata } from "next";

import { MasterOverviewView } from "@/components/platform/master-overview-view";
import { getMasterOverview } from "@/lib/data/master-overview";

export const metadata: Metadata = {
  title: "Painel 101Devs",
  robots: { index: false, follow: false },
};

/**
 * O endereço antigo do painel.
 *
 * Continua abrindo a visão geral em vez de redirecionar: o 101devs roteia
 * `/admin/discordbots/:path*` para cá, e um redirecionamento para `/admin`
 * quebraria o painel enquanto o roteamento novo não estivesse publicado nos dois
 * projetos. Com a página respondendo aqui, a ordem dos deploys não importa.
 */
export default async function DiscordBotsAdminPage() {
  return <MasterOverviewView overview={await getMasterOverview()} />;
}
