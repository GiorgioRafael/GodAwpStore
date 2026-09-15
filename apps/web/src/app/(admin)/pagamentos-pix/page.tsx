import { notFound } from "next/navigation";
import { IS_GWSTORE } from "@/lib/brand";
import { requireAdmin } from "@/lib/auth";
import { eclipseDatabase } from "@/lib/eclipsepay/runtime";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export default async function PixPaymentsPage() {
  await requireAdmin();
  if (!IS_GWSTORE) notFound();
  const { data, error } = await eclipseDatabase().from("eclipsepay_checkouts")
    .select("order_id,order_kind,amount_cents,net_cents,operation_status,review_required,created_at")
    .order("review_required", { ascending: false }).order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error("Não foi possível consultar os pagamentos Pix.");
  const status: Record<string, string> = { pending: "Aguardando pagamento", completed: "Confirmado", failed: "Não concluído", refunded: "Estornado — revisar" };
  const kinds: Record<string, string> = { items: "Itens", robux: "Robux", coins: "Moedas" };
  return <div className="space-y-6">
    <PageHeader eyebrow="Operação" title="Pagamentos Pix" description="Últimos 100 pagamentos EclipsePay. Estornos que exigem revisão aparecem primeiro. Pedidos LivePix antigos permanecem em Pedidos." />
    <Card className="p-5"><p className="text-sm text-muted">Um estorno não libera nova entrega e não devolve estoque ou saldo automaticamente. Confira o pedido, o ticket e a operação na EclipsePay antes de qualquer ajuste manual.</p></Card>
    <Card className="overflow-x-auto p-5"><table className="w-full text-left text-sm"><thead><tr><th className="p-3">Pedido</th><th className="p-3">Tipo</th><th className="p-3">Valor</th><th className="p-3">Líquido recebido</th><th className="p-3">Situação</th><th className="p-3">Criado em</th></tr></thead><tbody>
      {(data ?? []).map((row) => <tr key={row.order_id} className="border-t border-white/10"><td className="p-3 font-mono text-xs">{row.order_id}</td><td className="p-3">{kinds[row.order_kind]}</td><td className="p-3">{money(row.amount_cents)}</td><td className="p-3">{row.net_cents === null ? "A confirmar" : money(row.net_cents)}</td><td className={`p-3 ${row.review_required ? "text-red-400" : ""}`}>{status[row.operation_status]}</td><td className="p-3">{new Date(row.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td></tr>)}
      {!data?.length && <tr><td colSpan={6} className="p-6 text-center text-muted">Nenhuma cobrança EclipsePay registrada ainda.</td></tr>}
    </tbody></table></Card>
  </div>;
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) / 100);
}
