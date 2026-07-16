import type { Metadata } from "next";
import { formatBrl } from "@godawp/domain";
import { Landmark } from "lucide-react";

import { ResourcePage } from "@/components/admin/resource-page";
import { Badge } from "@/components/ui/badge";
import { listOperationalRows } from "@/lib/data/admin-repository";

export const metadata: Metadata = { title: "Saques" };

export default async function PayoutsPage() {
  const rows = await listOperationalRows("payouts", 500);
  return (
    <ResourcePage
      eyebrow="Financeiro"
      title="Saques"
      description="Visualize solicitações e o histórico financeiro. A operação de pagamento permanece fora desta versão."
      columns={["Solicitação", "Whitelist", "Valor", "Status", "Solicitado em", "Concluído em"]}
      emptyIcon={Landmark}
      emptyTitle="Nenhuma solicitação de saque"
      emptyDescription="Solicitações futuras serão exibidas aqui; nenhum fluxo operacional de saque está habilitado agora."
      readOnly
      recordCount={rows.length}
      rows={rows.map((row) => (
        <tr key={String(row.id)} className="border-b border-border/70 last:border-b-0">
          <td className="px-5 py-4 font-mono text-xs text-muted-strong" title={String(row.id)}>{String(row.id).slice(0, 8)}…</td>
          <td className="px-5 py-4 font-mono text-xs text-muted" title={String(row.whitelist_entry_id)}>{String(row.whitelist_entry_id).slice(0, 8)}…</td>
          <td className="px-5 py-4 text-sm font-medium">{formatBrl(Number(row.amount_cents))}</td>
          <td className="px-5 py-4"><Badge tone={row.status === "paid" ? "success" : row.status === "failed" || row.status === "rejected" ? "danger" : "warning"}>{String(row.status)}</Badge></td>
          <td className="px-5 py-4 text-xs text-muted">{new Date(String(row.requested_at)).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
          <td className="px-5 py-4 text-xs text-muted">{row.processed_at ? new Date(String(row.processed_at)).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—"}</td>
        </tr>
      ))}
    />
  );
}
