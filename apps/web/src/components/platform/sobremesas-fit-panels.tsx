import { formatBrl } from "@godawp/domain";
import { Filter, MousePointerClick, Radio, ShoppingBag } from "lucide-react";

import type {
  SobremesasFitBreakdownRow,
  SobremesasFitFunnelRow,
} from "@/lib/sobremesas-fit-contract";
import type { SobremesasFitOrderRow } from "@/lib/data/sobremesas-fit";

/** Blocos de detalhamento da aba: funil, origens, elementos e vendas. */

function PanelShell({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: typeof Filter;
  children: React.ReactNode;
}) {
  const headingId = `painel-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;

  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-[#0b121c] shadow-[0_22px_70px_rgba(0,0,0,.2)]"
    >
      <div className="flex items-start justify-between gap-4 border-b border-slate-800 p-5 sm:p-6">
        <div>
          <h2 id={headingId} className="text-base font-semibold tracking-tight text-white sm:text-lg">
            {title}
          </h2>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-slate-700 bg-slate-800/50 text-slate-400">
          <Icon aria-hidden="true" className="size-[17px]" strokeWidth={1.8} />
        </span>
      </div>
      {children}
    </section>
  );
}

function EmptyRow({ message }: { message: string }) {
  return <p className="px-5 py-8 text-center text-sm text-slate-500 sm:px-6">{message}</p>;
}

/**
 * Funil da visita até a compra.
 *
 * Cada etapa conta visitas únicas, então a largura da barra é diretamente
 * comparável com a de cima — e a diferença entre duas barras vizinhas é gente
 * que desistiu ali.
 */
export function SobremesasFitFunnel({ steps }: { steps: SobremesasFitFunnelRow[] }) {
  return (
    <PanelShell
      title="Funil de compra"
      description="Quantas visitas chegaram a cada etapa, e onde elas param."
      icon={Filter}
    >
      {steps.length === 0 ? (
        <EmptyRow message="Sem visitas registradas no período." />
      ) : (
        <ol className="space-y-3 p-5 sm:p-6">
          {steps.map((step, index) => (
            <li key={step.step}>
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <span className="font-medium text-slate-200">{step.label}</span>
                <span className="shrink-0 tabular-nums text-slate-400">
                  {step.visits.toLocaleString("pt-BR")}
                  <span className="ml-2 text-xs text-slate-500">
                    {step.shareOfVisits.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                  </span>
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className={index === steps.length - 1 ? "h-full rounded-full bg-emerald-400" : "h-full rounded-full bg-violet-500"}
                  style={{ width: `${Math.min(Math.max(step.shareOfVisits, 0), 100)}%` }}
                />
              </div>
              {index > 0 && step.dropOff > 0 ? (
                <p className="mt-1 text-xs text-slate-500">
                  {step.dropOff.toLocaleString("pt-BR")} não passaram desta etapa
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </PanelShell>
  );
}

/** Origens de tráfego, com o que cada uma trouxe de receita. */
export function SobremesasFitSources({ rows }: { rows: SobremesasFitBreakdownRow[] }) {
  return (
    <PanelShell
      title="Origem do tráfego"
      description="De onde vieram as visitas e quanto cada canal faturou."
      icon={Radio}
    >
      {rows.length === 0 ? (
        <EmptyRow message="Sem origens registradas no período." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                <th scope="col" className="px-5 py-3 font-medium sm:px-6">Canal</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">Visitas</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">Vendas</th>
                <th scope="col" className="px-5 py-3 text-right font-medium">Conversão</th>
                <th scope="col" className="px-5 py-3 text-right font-medium sm:px-6">Receita</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className="px-5 py-3 font-medium text-slate-200 sm:px-6">{row.label || row.key}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-300">
                    {row.sessions.toLocaleString("pt-BR")}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-300">
                    {row.purchases.toLocaleString("pt-BR")}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-400">
                    {row.conversionRate.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%
                  </td>
                  <td className="px-5 py-3 text-right font-medium tabular-nums text-emerald-300 sm:px-6">
                    {formatBrl(Math.round(row.revenue * 100))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
}

/** Cliques em botão e seções vistas, para saber qual parte da página trabalha. */
export function SobremesasFitElements({ rows }: { rows: SobremesasFitBreakdownRow[] }) {
  const ctas = rows.filter((row) => row.key.startsWith("cta:"));
  const sections = rows.filter((row) => row.key.startsWith("secao:"));
  const maxCount = Math.max(1, ...rows.map((row) => row.count));

  return (
    <PanelShell
      title="O que a página fez"
      description="Cliques em cada botão de compra e seções que apareceram na tela."
      icon={MousePointerClick}
    >
      {rows.length === 0 ? (
        <EmptyRow message="Sem interações registradas no período." />
      ) : (
        <div className="grid gap-6 p-5 sm:p-6 md:grid-cols-2">
          {[
            { title: "Cliques em comprar", items: ctas, prefix: "cta:" },
            { title: "Seções vistas", items: sections, prefix: "secao:" },
          ].map((group) => (
            <div key={group.title}>
              <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">{group.title}</h3>
              {group.items.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">Nada registrado ainda.</p>
              ) : (
                <ul className="mt-3 space-y-2.5">
                  {group.items.map((row) => (
                    <li key={row.key}>
                      <div className="flex items-baseline justify-between gap-4 text-sm">
                        <span className="text-slate-300">{row.key.slice(group.prefix.length)}</span>
                        <span className="shrink-0 tabular-nums text-slate-400">
                          {row.count.toLocaleString("pt-BR")}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full bg-slate-500"
                          style={{ width: `${(row.count / maxCount) * 100}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

const STATUS_LABELS: Record<SobremesasFitOrderRow["status"], { label: string; className: string }> = {
  approved: { label: "Aprovada", className: "bg-emerald-400/10 text-emerald-300" },
  pending: { label: "Pendente", className: "bg-amber-400/10 text-amber-300" },
  rejected: { label: "Recusada", className: "bg-rose-400/10 text-rose-300" },
  refunded: { label: "Reembolsada", className: "bg-slate-500/15 text-slate-300" },
};

const orderDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

/** Vendas recentes. O comprador aparece mascarado, como a API entrega. */
export function SobremesasFitOrders({ orders }: { orders: SobremesasFitOrderRow[] }) {
  return (
    <PanelShell
      title="Vendas recentes"
      description="As últimas compras do e-book, com origem e situação da entrega."
      icon={ShoppingBag}
    >
      {orders.length === 0 ? (
        <EmptyRow message="Nenhuma venda registrada no período." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                <th scope="col" className="px-5 py-3 font-medium sm:px-6">Comprador</th>
                <th scope="col" className="px-5 py-3 font-medium">Situação</th>
                <th scope="col" className="px-5 py-3 font-medium">Origem</th>
                <th scope="col" className="px-5 py-3 font-medium">Quando</th>
                <th scope="col" className="px-5 py-3 text-right font-medium sm:px-6">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {orders.map((order) => {
                const status = STATUS_LABELS[order.status];
                return (
                  <tr key={order.paymentId}>
                    <td className="px-5 py-3 sm:px-6">
                      <p className="font-medium text-slate-200">{order.buyerMask ?? "não informado"}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {order.method ?? "—"}
                        {order.status === "approved" ? (order.delivered ? " · entregue" : " · entrega pendente") : ""}
                      </p>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-400">
                      {order.source ?? "direct"}
                      {order.campaign ? <span className="block text-xs text-slate-500">{order.campaign}</span> : null}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-slate-400">
                      {order.createdAt ? orderDateFormatter.format(new Date(order.createdAt)) : "—"}
                    </td>
                    <td className="px-5 py-3 text-right font-medium tabular-nums text-white sm:px-6">
                      {formatBrl(order.amountCents)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
}
