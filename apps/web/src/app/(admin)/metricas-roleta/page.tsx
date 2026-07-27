import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChartNoAxesCombined } from "lucide-react";

import { Notice } from "@/components/admin/notice";
import { PageHeader } from "@/components/admin/page-header";
import { RouletteMetricsPanel } from "@/components/admin/roulette-metrics-panel";
import { EmptyState } from "@/components/ui/empty-state";
import { STORE_SLUG } from "@/lib/brand";
import { getRouletteMetrics } from "@/lib/roulette/metrics";

export const metadata: Metadata = { title: "Métricas da roleta" };
export const dynamic = "force-dynamic";

export default async function RouletteMetricsPage() {
  // A roleta existe só na GWStore; nas outras lojas a rota não deve nem existir.
  if (STORE_SLUG !== "gwstore") notFound();

  const metrics = await getRouletteMetrics();

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Roleta"
        title="Métricas"
        description="Resultado da roleta em separado dos pedidos da loja: o que os jogadores depositaram, o que a roleta pagou em prêmios e o que sobrou."
      />
      <Notice>
        Estes números vêm apenas das moedas e dos prêmios da roleta. A receita dos pedidos pagos
        continua na visão geral, sem soma nem sobreposição com o que aparece aqui.
      </Notice>
      {metrics ? (
        <RouletteMetricsPanel metrics={metrics} />
      ) : (
        <EmptyState
          icon={ChartNoAxesCombined}
          title="Métricas indisponíveis"
          description="Não foi possível ler os dados da roleta agora. Recarregue a página; se continuar, confira se a sua conta ainda tem acesso de administrador."
        />
      )}
    </div>
  );
}
