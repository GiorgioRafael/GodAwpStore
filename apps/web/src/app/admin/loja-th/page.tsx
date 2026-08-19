import type { Metadata } from "next";

import { MasterServiceView } from "@/components/platform/master-service-view";
import { getDiscordBotsDashboard } from "@/lib/data/discord-bots-dashboard";
import { findMasterAdminTab } from "@/lib/master-admin-tabs";

export const metadata: Metadata = {
  title: "Loja TH | 101Devs",
  robots: { index: false, follow: false },
};

export default async function LojaThTabPage() {
  const dashboard = await getDiscordBotsDashboard();
  const tab = findMasterAdminTab("loja-th");

  return (
    <MasterServiceView
      service={dashboard.services.find((service) => service.id === tab?.serviceId)}
      description="Loja parceira, lida por um instantâneo assinado do painel dela."
    />
  );
}
