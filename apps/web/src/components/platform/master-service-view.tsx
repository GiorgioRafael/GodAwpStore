import { formatBrl } from "@godawp/domain";
import {
  Bot,
  CalendarDays,
  CircleDollarSign,
  ExternalLink,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from "lucide-react";

import { formatCommission } from "@/components/admin/admin-format";
import { BusinessBotsTable } from "@/components/platform/business-bots-table";
import {
  MasterMetricCard,
  MasterPageHeader,
  currentPeriodLabel,
} from "@/components/platform/master-metric-card";
import type { DiscordBotService } from "@/lib/data/discord-bots-dashboard";
import { calculateRevenueChange } from "@/lib/discord-bots-dashboard";

/**
 * Uma loja de bots, sozinha na própria aba.
 *
 * O faturamento bruto aparece aqui porque é o dado operacional da loja — é o que
 * mostra se ela está vendendo. O que a 101Devs ganha com ela é a comissão, e é
 * essa a linha que sobe para a visão geral.
 */
export function MasterServiceView({
  service,
  description,
}: {
  service: DiscordBotService | undefined;
  description: string;
}) {
  if (!service) {
    return (
      <div className="space-y-5">
        <MasterPageHeader title="Serviço não encontrado" description={description} />
        <p className="rounded-2xl border border-slate-800 bg-[#0b121c] p-6 text-sm text-slate-400">
          Este serviço não está mais registrado no painel. Verifique a configuração das lojas
          conectadas antes de procurar o dado.
        </p>
      </div>
    );
  }

  const change = calculateRevenueChange(
    service.currentMonthRevenueCents,
    service.previousMonthRevenueCents,
  );
  const ChangeIcon = change != null && change < 0 ? TrendingDown : TrendingUp;

  return (
    <div className="space-y-5 sm:space-y-6">
      <MasterPageHeader
        title={service.name}
        description={description}
        aside={
          <>
            <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-700 bg-[#0b121c] px-3.5 text-xs font-medium text-slate-300">
              <CalendarDays aria-hidden="true" className="size-4 text-slate-500" />
              {currentPeriodLabel()}
            </span>
            <a
              href={service.adminPanelUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-700 bg-[#0b121c] px-3.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-600 hover:text-white"
            >
              <ExternalLink aria-hidden="true" className="size-3.5" />
              Abrir painel da loja
            </a>
          </>
        }
      />

      {service.error ? (
        <p role="status" className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-4 text-sm text-amber-200">
          {service.error}
        </p>
      ) : null}

      <section aria-label={`Resumo da ${service.name}`} className="grid gap-3 sm:grid-cols-2 min-[1100px]:grid-cols-4">
        <MasterMetricCard
          label="Comissão da 101Devs"
          value={formatBrl(service.currentMonthCommissionCents)}
          detail={`${formatCommission(service.effectiveCommissionBps)} sobre o faturamento bruto pago`}
          icon={WalletCards}
          accent="violet"
        />
        <MasterMetricCard
          label="Faturamento da loja"
          value={formatBrl(service.currentMonthRevenueCents)}
          detail={
            change == null
              ? "Sem base comparável no mês anterior"
              : `${change > 0 ? "+" : ""}${change.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% em relação ao mês anterior`
          }
          icon={ChangeIcon}
        />
        <MasterMetricCard
          label="Pedidos pagos"
          value={service.currentMonthPaidOrdersCount.toLocaleString("pt-BR")}
          detail={`Mês anterior: ${formatBrl(service.previousMonthRevenueCents)} em vendas`}
          icon={ShoppingBag}
        />
        <MasterMetricCard
          label="Bots conectados"
          value={service.bots.length.toLocaleString("pt-BR")}
          detail={`Situação do serviço: ${service.health.label}`}
          icon={Bot}
          accent={service.health.tone === "success" ? "success" : "neutral"}
        />
      </section>

      <BusinessBotsTable services={[service]} />

      <p className="flex items-start gap-2 rounded-2xl border border-slate-800 bg-[#0b121c] p-5 text-xs leading-5 text-slate-500">
        <CircleDollarSign aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-slate-600" />
        O faturamento acima é da loja, não da 101Devs. Na visão geral entra somente a comissão.
      </p>
    </div>
  );
}
