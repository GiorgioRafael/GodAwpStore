import type { Metadata } from "next";

import { MasterServiceView } from "@/components/platform/master-service-view";
import { getDiscordBotsDashboard } from "@/lib/data/discord-bots-dashboard";
import { findMasterAdminTab } from "@/lib/master-admin-tabs";

export const metadata: Metadata = {
  title: "GWStore | 101Devs",
  robots: { index: false, follow: false },
};

export default async function GwStoreTabPage() {
  const dashboard = await getDiscordBotsDashboard();
  const tab = findMasterAdminTab("gwstore");

  return (
    <MasterServiceView
      service={dashboard.services.find((service) => service.id === tab?.serviceId)}
      description="Loja de bots hospedada nesta aplicação, com vendas confirmadas pela LivePix."
    />
  );
}
