import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCheck, PackageCheck } from "lucide-react";
import { formatBrl } from "@godawp/domain";

import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TableEmptyRow, TableShell } from "@/components/ui/table-shell";
import { listDeliveryLog } from "@/lib/data/admin-repository";
import { resolveOrdersPage } from "@/lib/orders-period";

export const metadata: Metadata = { title: "Entregas" };

const DELIVERY_LOG_PAGE_SIZE = 50;

type DeliveryLogPageProps = {
  searchParams: Promise<{ page?: string | string[] }>;
};

function dateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function deliveryDate(row: { discord_ticket_delivery_completed_at: string | null; delivered_at: string | null; created_at: string }) {
  return row.discord_ticket_delivery_completed_at ?? row.delivered_at ?? row.created_at;
}

function pageHref(page: number) {
  return page <= 1 ? "/entregas" : `/entregas?page=${page}`;
}

export default async function DeliveryLogPage({ searchParams }: DeliveryLogPageProps) {
  const page = resolveOrdersPage((await searchParams).page);
  const deliveries = await listDeliveryLog({ page, pageSize: DELIVERY_LOG_PAGE_SIZE });

  if (deliveries.total > 0 && page > deliveries.totalPages) {
    redirect(pageHref(deliveries.totalPages));
  }

  const firstVisible = deliveries.total === 0 ? 0 : (deliveries.page - 1) * deliveries.pageSize + 1;
  const lastVisible = Math.min(deliveries.page * deliveries.pageSize, deliveries.total);

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Operação"
        title="Entregas"
        description="Registro automático de tudo que foi marcado como entregue pelo bot no Discord."
      />

      <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-success/25 bg-success/[0.08] text-success">
            <CheckCheck aria-hidden="true" className="size-5" />
          </span>
          <div>
            <p className="font-semibold text-foreground">{deliveries.total.toLocaleString("pt-BR")} entrega(s) registrada(s)</p>
            <p className="mt-1 text-sm text-muted">A lista é atualizada assim que a equipe conclui uma entrega no ticket.</p>
          </div>
        </div>
        <Badge tone="success" className="w-fit">Somente entregues</Badge>
      </Card>

      <div className="space-y-3">
        <TableShell
          columns={["Entrega", "Comprador", "Itens entregues", "Valor", "Concluída por", "Data e hora"]}
          caption="Log de entregas concluídas"
        >
          {deliveries.rows.length > 0 ? (
            deliveries.rows.map((row) => (
              <tr key={row.id} className="border-b border-border/70 last:border-b-0">
                <td className="px-5 py-4 font-mono text-xs text-muted-strong" title={row.id}>{row.id.slice(0, 8)}…</td>
                <td className="px-5 py-4 font-mono text-xs text-muted">{row.buyer_discord_id}</td>
                <td className="px-5 py-4 text-xs text-muted">
                  {row.items.length > 0 ? (
                    <ul className="space-y-1">
                      {row.items.map((item) => (
                        <li key={item.productId} title={item.productId}>
                          <span className="font-medium text-muted-strong">{item.productName}</span>
                          {" ×"}{item.quantity.toLocaleString("pt-BR")}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="font-mono" title={row.product_id}>{row.product_id.slice(0, 8)}…</span>
                  )}
                </td>
                <td className="px-5 py-4 text-sm font-medium">{formatBrl(row.sale_price_cents)}</td>
                <td className="px-5 py-4 text-xs text-muted">
                  {row.discord_ticket_delivery_completed_by_discord_user_id ?? "Entrega antiga"}
                </td>
                <td className="px-5 py-4 text-xs text-muted">{dateTime(deliveryDate(row))}</td>
              </tr>
            ))
          ) : (
            <TableEmptyRow colSpan={6}>
              <EmptyState
                icon={PackageCheck}
                title="Nenhuma entrega registrada"
                description="Quando a equipe marcar uma entrega como concluída no Discord, ela aparecerá aqui automaticamente."
                compact
              />
            </TableEmptyRow>
          )}
        </TableShell>

        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted">
            Mostrando {firstVisible.toLocaleString("pt-BR")}–{lastVisible.toLocaleString("pt-BR")} de {deliveries.total.toLocaleString("pt-BR")}
          </p>
          <div className="flex items-center gap-2">
            <Link
              href={pageHref(Math.max(1, deliveries.page - 1))}
              aria-disabled={deliveries.page <= 1}
              className={`rounded-xl border px-3 py-2 text-sm font-medium ${deliveries.page <= 1 ? "pointer-events-none opacity-45" : "hover:border-gold-muted"}`}
            >
              Anterior
            </Link>
            <span className="min-w-20 text-center text-xs text-muted-strong">{deliveries.page} de {deliveries.totalPages}</span>
            <Link
              href={pageHref(Math.min(deliveries.totalPages, deliveries.page + 1))}
              aria-disabled={deliveries.page >= deliveries.totalPages}
              className={`rounded-xl border px-3 py-2 text-sm font-medium ${deliveries.page >= deliveries.totalPages ? "pointer-events-none opacity-45" : "hover:border-gold-muted"}`}
            >
              Próxima
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
