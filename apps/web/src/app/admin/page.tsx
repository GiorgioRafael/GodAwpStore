import type { Metadata } from "next";

import { MasterOverviewView } from "@/components/platform/master-overview-view";
import { getMasterOverview } from "@/lib/data/master-overview";

export const metadata: Metadata = {
  title: "Visão geral | 101Devs",
  description: "Painel privado de faturamento e operação dos produtos da 101Devs.",
  robots: { index: false, follow: false },
};

export default async function MasterAdminOverviewPage() {
  return <MasterOverviewView overview={await getMasterOverview()} />;
}
