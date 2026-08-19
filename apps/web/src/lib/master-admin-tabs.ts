import { MASTER_ADMIN_ROOT } from "@/lib/master-admin-auth";

/**
 * As abas do painel mestre, uma por produto.
 *
 * A ordem é a da navegação. `serviceId` liga a aba ao serviço correspondente em
 * `getDiscordBotsDashboard`; a Sobremesas Fit não tem um porque não é um bot —
 * ela vem da API de métricas do próprio site.
 */
export type MasterAdminTab = {
  id: string;
  label: string;
  href: string;
  description: string;
  serviceId?: string;
};

export const MASTER_ADMIN_TABS: MasterAdminTab[] = [
  {
    id: "visao-geral",
    label: "Visão geral",
    href: MASTER_ADMIN_ROOT,
    description: "O que a 101Devs faturou somando todos os produtos.",
  },
  {
    id: "gwstore",
    label: "GWStore",
    href: `${MASTER_ADMIN_ROOT}/gwstore`,
    description: "Bots, vendas e comissão da GWStore.",
    serviceId: "gwstore",
  },
  {
    id: "loja-th",
    label: "Loja TH",
    href: `${MASTER_ADMIN_ROOT}/loja-th`,
    description: "Bots, vendas e comissão da Loja TH.",
    serviceId: "thstore",
  },
  {
    id: "sobremesas-fit",
    label: "Sobremesas Fit",
    href: `${MASTER_ADMIN_ROOT}/sobremesas-fit`,
    description: "Audiência, funil e vendas do e-book de receitas.",
  },
];

export function findMasterAdminTab(id: string) {
  return MASTER_ADMIN_TABS.find((tab) => tab.id === id);
}
