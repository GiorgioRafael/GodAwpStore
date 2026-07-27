import {
  Coins,
  Landmark,
  PackageCheck,
  Percent,
  Receipt,
  RotateCw,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import { formatBrl } from "@godawp/domain";
import { MetricCard } from "@/components/admin/metric-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import {
  prizeOutcomeShares,
  realisedReturnBps,
  worstCaseProfitCents,
  type RouletteMetrics,
} from "@/lib/roulette/metrics";

export function RouletteMetricsPanel({ metrics }: { metrics: RouletteMetrics }) {
  const shares = prizeOutcomeShares(metrics);
  const returnBps = realisedReturnBps(metrics);
  const worstCase = worstCaseProfitCents(metrics);
  const netRevenue = metrics.depositGrossCents - metrics.providerFeeCents;
  const exposure =
    metrics.coinLiabilityCents + metrics.pendingCostCents + metrics.heldCostCents;

  const result = [
    {
      label: "Depósitos confirmados",
      value: formatBrl(metrics.depositGrossCents),
      detail: `${formatCount(metrics.depositCount)} recarga(s) de ${formatCount(metrics.depositPayerCount)} jogador(es)`,
      icon: Landmark,
    },
    {
      label: `Taxa LivePix (${formatBps(metrics.feeBps)})`,
      value: `− ${formatBrl(metrics.providerFeeCents)}`,
      detail: `Sobra ${formatBrl(netRevenue)} do que entrou`,
      icon: Receipt,
    },
    {
      label: "Custo dos prêmios entregues",
      value: `− ${formatBrl(metrics.deliveredCostCents)}`,
      detail: `${formatCount(metrics.deliveredUnitCount)} unidade(s) valendo ${formatBrl(metrics.deliveredValueCents)}`,
      icon: PackageCheck,
    },
    {
      label: "Lucro líquido estimado",
      value: formatBrl(metrics.netProfitCents),
      detail: "Depósitos − taxa − custo do que já saiu",
      icon: TrendingUp,
      trend: (metrics.netProfitCents >= 0 ? "up" : "down") as "up" | "down",
    },
  ];

  return (
    <div className="space-y-7">
      <section aria-labelledby="roulette-result-title" className="space-y-4">
        <div>
          <h2
            id="roulette-result-title"
            className="text-base font-semibold tracking-tight text-foreground"
          >
            Resultado da roleta
          </h2>
          <p className="mt-1 text-sm text-muted">
            Somente moedas e prêmios de contas de jogador. Nem os pedidos da loja nem os giros de
            teste da equipe entram nesta conta.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {result.map((metric) => (
            <MetricCard key={metric.label} {...metric} />
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold tracking-tight">Destino dos prêmios</h2>
              <p className="mt-1 text-sm text-muted">
                Todo prêmio sorteado acaba vendido de volta, resgatado ou parado no inventário.
              </p>
            </div>
            <Badge tone="neutral">{formatCount(shares?.total ?? 0)} unidades</Badge>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            {shares ? (
              <>
                <div
                  className="flex h-2.5 overflow-hidden rounded-full bg-surface-muted"
                  role="img"
                  aria-label={`Vendidos ${formatBps(shares.soldBps)}, resgatados ${formatBps(shares.redeemedBps)}, no inventário ${formatBps(shares.heldBps)}`}
                >
                  <ShareBar bps={shares.soldBps} className="bg-gold" />
                  <ShareBar bps={shares.redeemedBps} className="bg-success" />
                  <ShareBar bps={shares.heldBps} className="bg-white/25" />
                </div>
                <dl className="space-y-2.5">
                  <ShareRow
                    dot="bg-gold"
                    label="Vendidos de volta"
                    share={formatBps(shares.soldBps)}
                    detail={`${formatCount(metrics.soldUnitCount)} un. · ${formatBrl(metrics.soldCreditedCents)} devolvidos em moeda (${formatBps(metrics.saleRateBps)} do valor)`}
                  />
                  <ShareRow
                    dot="bg-success"
                    label="Resgatados"
                    share={formatBps(shares.redeemedBps)}
                    detail={`${formatCount(metrics.redeemedUnitCount)} un. · ${formatCount(metrics.deliveredUnitCount)} entregues e ${formatCount(metrics.pendingRedemptionCount)} pedido(s) na fila`}
                  />
                  <ShareRow
                    dot="bg-white/25"
                    label="Ainda no inventário"
                    share={formatBps(shares.heldBps)}
                    detail={`${formatCount(metrics.heldUnitCount)} un. · ${formatBrl(metrics.heldValueCents)} em valor de tabela`}
                  />
                </dl>
              </>
            ) : (
              <p className="text-sm text-muted">Nenhum prêmio sorteado ainda.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold tracking-tight">Giros e retorno</h2>
            <p className="mt-1 text-sm text-muted">
              Cada giro custa uma moeda, então o retorno é o quanto a roleta devolve em prêmio a
              cada real girado.
            </p>
          </CardHeader>
          <CardContent className="grid gap-3 pt-0 sm:grid-cols-2">
            <Stat
              icon={RotateCw}
              label="Giros"
              value={formatCount(metrics.spinCount)}
              detail={`${formatBrl(metrics.coinsSpentCents)} em moedas gastas`}
            />
            <Stat
              icon={UsersRound}
              label="Jogadores"
              value={formatCount(metrics.spinnerCount)}
              detail={`${formatCount(metrics.depositPayerCount)} ${
                metrics.depositPayerCount === 1 ? "recarregou moedas" : "recarregaram moedas"
              }`}
            />
            <Stat
              icon={Coins}
              label="Prêmios sorteados"
              value={formatBrl(metrics.awardedValueCents)}
              detail="Valor de tabela do que a roleta pagou"
            />
            <Stat
              icon={Percent}
              label="Retorno ao jogador"
              value={returnBps === null ? "—" : formatBps(returnBps)}
              detail={
                returnBps === null
                  ? "Depende de pelo menos um giro pago"
                  : "Prêmio pago por moeda gasta"
              }
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Compromissos em aberto</h2>
            <p className="mt-1 text-sm text-muted">
              O que a loja ainda deve entregar. O lucro acima só desconta o que já saiu.
            </p>
          </div>
          <Badge tone={exposure > metrics.netProfitCents ? "warning" : "neutral"}>
            {formatBrl(exposure)} em aberto
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="grid gap-3 sm:grid-cols-3">
            <Liability
              label="Moedas em carteira"
              value={formatBrl(metrics.coinLiabilityCents)}
              detail="Já entrou no caixa, mas ainda vai virar giro"
            />
            <Liability
              label="Resgates na fila"
              value={formatBrl(metrics.pendingCostCents)}
              detail={`Custo de ${formatCount(metrics.pendingRedemptionCount)} pedido(s) aguardando entrega`}
            />
            <Liability
              label="Prêmios no inventário"
              value={formatBrl(metrics.heldCostCents)}
              detail="Custo se todos forem resgatados em vez de vendidos"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-muted/35 px-4 py-3.5">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted">
                Lucro se tudo pendente for entregue
              </p>
              <p className="mt-1 text-xs text-muted">
                Cenário mais pessimista: ninguém revende, todo mundo resgata.
              </p>
            </div>
            <p
              className={cn(
                "text-lg font-semibold tracking-[-0.03em]",
                worstCase >= 0 ? "text-success" : "text-danger",
              )}
            >
              {formatBrl(worstCase)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold tracking-tight">Premissas do cálculo</h2>
          <p className="mt-1 text-sm text-muted">
            Ajustáveis em <code className="text-muted-strong">platform_settings</code>. O custo do
            prêmio sai do preço de tabela dividido pelo markup.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 pt-0 sm:grid-cols-3">
          <Liability
            label="Markup sobre o custo"
            value={formatBps(metrics.markupBps)}
            detail={`Item comprado por ${formatBrl(100)} é vendido por ${formatBrl(100 + metrics.markupBps / 100)}`}
          />
          <Liability
            label="Taxa do LivePix"
            value={formatBps(metrics.feeBps)}
            detail="Retida em cada Pix recebido"
          />
          <Liability
            label="Recompra do prêmio"
            value={formatBps(metrics.saleRateBps)}
            detail="Moedas devolvidas quando o jogador revende"
          />
        </CardContent>
      </Card>
    </div>
  );
}

function ShareBar({ bps, className }: { bps: number; className: string }) {
  if (bps <= 0) return null;
  return <div className={className} style={{ width: `${bps / 100}%` }} />;
}

function ShareRow({
  dot,
  label,
  share,
  detail,
}: {
  dot: string;
  label: string;
  share: string;
  detail: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-start gap-2.5">
        <span aria-hidden="true" className={cn("mt-1.5 size-2 shrink-0 rounded-full", dot)} />
        <div>
          <dt className="text-sm font-medium text-foreground">{label}</dt>
          <dd className="mt-0.5 text-xs leading-5 text-muted">{detail}</dd>
        </div>
      </div>
      <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{share}</p>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-muted/35 px-4 py-3.5">
      <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted">
        <Icon aria-hidden="true" className="size-3.5 text-gold" strokeWidth={1.8} />
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-foreground">{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted">{detail}</p>
    </div>
  );
}

function Liability({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-muted/35 px-4 py-3.5">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-foreground">{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted">{detail}</p>
    </div>
  );
}

function formatCount(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatBps(value: number) {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value / 100)}%`;
}
