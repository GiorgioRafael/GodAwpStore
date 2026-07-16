import type { Metadata } from "next";
import { formatBrl } from "@godawp/domain";
import { ReceiptText } from "lucide-react";

import { ResourcePage } from "@/components/admin/resource-page";
import { Badge } from "@/components/ui/badge";
import { listOperationalRows } from "@/lib/data/admin-repository";

export const metadata: Metadata = { title: "Pedidos" };

export default async function OrdersPage() {
  const rows = await listOperationalRows("orders", 500);
  return (
    <ResourcePage
      eyebrow="Operação"
      title="Pedidos"
      description="Acompanhe o ciclo de pagamento, reserva e entrega sem expor o conteúdo secreto do estoque."
      columns={["Pedido", "Cliente", "Produto", "Total", "Status", "Pagamento", "Criado em"]}
      emptyIcon={ReceiptText}
      emptyTitle="Nenhum pedido registrado"
      emptyDescription="Pedidos reais aparecerão aqui após a integração do bot e do provedor de pagamentos."
      readOnly
      recordCount={rows.length}
      rows={rows.map((row) => (
        <tr key={String(row.id)} className="border-b border-border/70 last:border-b-0">
          <td className="px-5 py-4 font-mono text-xs text-muted-strong" title={String(row.id)}>{String(row.id).slice(0, 8)}…</td>
          <td className="px-5 py-4 font-mono text-xs text-muted">{String(row.buyer_discord_id)}</td>
          <td className="px-5 py-4 font-mono text-xs text-muted" title={String(row.product_id)}>{String(row.product_id).slice(0, 8)}…</td>
          <td className="px-5 py-4 text-sm font-medium">{formatBrl(Number(row.sale_price_cents))}</td>
          <td className="px-5 py-4"><Badge tone={row.status === "delivered" ? "success" : row.status === "failed" ? "danger" : "warning"}>{String(row.status)}</Badge></td>
          <td className="px-5 py-4 text-xs text-muted">{row.paid_at ? new Date(String(row.paid_at)).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "Pendente"}</td>
          <td className="px-5 py-4 text-xs text-muted">{new Date(String(row.created_at)).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
        </tr>
      ))}
    />
  );
}
