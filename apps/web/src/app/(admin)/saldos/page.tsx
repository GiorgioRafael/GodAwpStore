import type { Metadata } from "next";
import { formatBrl } from "@godawp/domain";
import { WalletCards } from "lucide-react";

import { ResourcePage } from "@/components/admin/resource-page";
import { listOperationalRows } from "@/lib/data/admin-repository";

export const metadata: Metadata = { title: "Saldos" };

function cents(value: unknown) {
  const number = Number(value ?? 0);
  return formatBrl(Number.isSafeInteger(number) ? number : 0);
}

export default async function BalancesPage() {
  const rows = await listOperationalRows("whitelist_balances", 500);
  return (
    <ResourcePage
      eyebrow="Financeiro"
      title="Saldos"
      description="Consulte valores pendentes e disponíveis derivados do livro-razão imutável da plataforma."
      columns={["Discord ID", "Pendente", "Disponível", "Saldo", "Lucro total", "Pago"]}
      emptyIcon={WalletCards}
      emptyTitle="Nenhum saldo calculado"
      emptyDescription="Os saldos serão derivados exclusivamente de vendas e movimentações registradas no livro-razão."
      readOnly
      recordCount={rows.length}
      rows={rows.map((row) => (
        <tr key={String(row.whitelist_entry_id)} className="border-b border-border/70 last:border-b-0">
          <td className="px-5 py-4 font-mono text-xs text-muted-strong">{String(row.discord_id)}</td>
          <td className="px-5 py-4 text-sm">{cents(row.pending_balance_cents)}</td>
          <td className="px-5 py-4 text-sm text-success">{cents(row.available_balance_cents)}</td>
          <td className="px-5 py-4 text-sm font-medium">{cents(row.balance_cents)}</td>
          <td className="px-5 py-4 text-sm">{cents(row.total_profit_cents)}</td>
          <td className="px-5 py-4 text-sm text-muted">{cents(row.total_paid_out_cents)}</td>
        </tr>
      ))}
    />
  );
}
