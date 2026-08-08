import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChartNoAxesCombined, CircleAlert, MonitorPlay } from "lucide-react";

import { Notice } from "@/components/admin/notice";
import { PageHeader } from "@/components/admin/page-header";
import { RouletteMetricsPanel } from "@/components/admin/roulette-metrics-panel";
import { RoulettePowerSwitch } from "@/components/admin/roulette-power-switch";
import { RouletteWheelEditor } from "@/components/admin/roulette-wheel-editor";
import { RouletteOverlayLink } from "@/components/admin/roulette-overlay-link";
import { RoulettePromotionEditor } from "@/components/admin/roulette-promotion-editor";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getSiteUrl } from "@/lib/env";
import { ROULETTE_AVAILABLE } from "@/lib/roulette/availability";
import { hasPlayerActivity, getRouletteMetrics } from "@/lib/roulette/metrics";
import { getRouletteOverlayLink } from "@/lib/roulette/overlay-link";
import { getRoulettePromotionSettings } from "@/lib/roulette/promotion-admin";
import { getRouletteWheelAdmin } from "@/lib/roulette/wheel-admin";
import { wheelEconomics } from "@/lib/roulette/wheel-economics";

export const metadata: Metadata = { title: "Roleta" };
export const dynamic = "force-dynamic";

export default async function RouletteMetricsPage() {
  // A roleta existe só na GWStore; nas outras lojas a rota não deve nem existir.
  if (!ROULETTE_AVAILABLE) notFound();

  const [overlay, metrics, wheel, promotion] = await Promise.all([
    getRouletteOverlayLink(),
    getRouletteMetrics(),
    getRouletteWheelAdmin(),
    getRoulettePromotionSettings(),
  ]);

  // O custo das moedas ainda em carteira depende do que a roda paga, então o
  // número vem da roda de verdade e não de uma constante.
  const wheelReturnBps = wheel.ok
    ? wheelEconomics(wheel.slots, {
        markupBps: metrics?.markupBps ?? 7000,
        feeBps: metrics?.feeBps ?? 500,
        saleRateBps: metrics?.saleRateBps ?? 5000,
      }).returnBps
    : 0;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Gestão"
        title="Roleta"
        description="A roda, as taxas, o overlay e o resultado — tudo o que a roleta tem, em um lugar só. Os números ficam separados dos pedidos da loja."
      />
      <Notice>
        Mudanças aqui valem na hora, sem deploy. Os números contam apenas moedas
        e prêmios de contas de jogador — os giros de teste da equipe ficam de
        fora, e a receita dos pedidos pagos continua na visão geral, sem soma
        nem sobreposição.
      </Notice>

      {wheel.ok ? (
        <>
          <RoulettePowerSwitch enabled={wheel.enabled} />
          <RouletteWheelEditor
            slots={wheel.slots}
            candidates={wheel.candidates}
            markupBps={metrics?.markupBps ?? 7000}
            feeBps={metrics?.feeBps ?? 500}
            saleRateBps={metrics?.saleRateBps ?? 5000}
          />
        </>
      ) : (
        // Esconder isto em silêncio manda o admin procurar o editor numa página
        // que decidiu não mostrá-lo.
        <Card>
          <CardContent>
            <EmptyState
              compact
              icon={CircleAlert}
              title="Não foi possível carregar os itens da roleta"
              description={`O banco recusou a leitura da roda — ${wheel.reason}`}
            />
          </CardContent>
        </Card>
      )}

      <RoulettePromotionEditor
        settings={promotion.settings}
        rouletteUrl={new URL("/roleta", getSiteUrl()).toString()}
      />

      {overlay.status === "ready" ? (
        <RouletteOverlayLink overlayUrl={overlay.url} />
      ) : overlay.status === "forbidden" ? null : (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold tracking-tight">
              Overlay para OBS e TikTok Studio
            </h2>
          </CardHeader>
          <CardContent className="pt-0">
            <EmptyState
              compact
              icon={MonitorPlay}
              title="Overlay ainda não configurado"
              description={
                overlay.missing === "token"
                  ? "Defina ROULETTE_OVERLAY_TOKEN nas variáveis de ambiente da hospedagem e recarregue esta página para receber o endereço."
                  : "Defina NEXT_PUBLIC_SITE_URL nas variáveis de ambiente da hospedagem para que o endereço do overlay possa ser montado."
              }
            />
          </CardContent>
        </Card>
      )}

      {!metrics ? (
        <EmptyState
          icon={ChartNoAxesCombined}
          title="Métricas indisponíveis"
          description="Não foi possível ler os dados da roleta agora. Recarregue a página; se continuar, confira se a sua conta ainda tem acesso de administrador."
        />
      ) : hasPlayerActivity(metrics) ? (
        <RouletteMetricsPanel
          metrics={metrics}
          wheelReturnBps={wheelReturnBps}
        />
      ) : (
        <EmptyState
          icon={ChartNoAxesCombined}
          title="Nenhum jogador usou a roleta ainda"
          description="Os giros de administrador não entram nesta conta. Assim que alguém recarregar moedas e girar, o depósito, o custo dos prêmios e o lucro aparecem aqui."
        />
      )}
    </div>
  );
}
