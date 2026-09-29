import { notFound } from "next/navigation";
import { IS_GWSTORE } from "@/lib/brand";
import { requireAdmin } from "@/lib/auth";
import { eclipseDatabase } from "@/lib/eclipsepay/runtime";
import { getSiteUrl } from "@/lib/env";
import { PageHeader } from "@/components/admin/page-header";
import { PublicPaymentLink } from "@/components/admin/public-payment-link";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export default async function PixPaymentsPage() {
  await requireAdmin();
  if (!IS_GWSTORE) notFound();
  const [orders, publicPayments] = await Promise.all([
    eclipseDatabase().from("eclipsepay_checkouts")
      .select("order_id,order_kind,amount_cents,net_cents,operation_status,review_required,created_at")
      .order("review_required", { ascending: false }).order("created_at", { ascending: false }).limit(100),
    eclipseDatabase().from("eclipsepay_payment_links")
      .select("id,payer_name,payer_details,amount_cents,net_cents,operation_status,confirmed_at,created_at")
      .order("created_at", { ascending: false }).limit(100),
  ]);
  if (orders.error || publicPayments.error) throw new Error("Não foi possível consultar os pagamentos Pix.");
  const status: Record<string, string> = { pending: "Aguardando pagamento", completed: "Confirmado", failed: "Não concluído", refunded: "Estornado — revisar" };
  const kinds: Record<string, string> = { items: "Itens", robux: "Robux", coins: "Moedas" };
  return <div className="space-y-6">
    <PageHeader eyebrow="Operação" title="Pagamentos Pix" description="Cobranças do link público e da loja confirmadas pela EclipsePay. Pedidos LivePix antigos permanecem em Pedidos." />
    <Card className="space-y-3 p-5">
      <h2 className="text-lg font-semibold">Link público de pagamento</h2>
      <p className="text-sm text-muted">Envie aos compradores apenas o link abaixo. O endereço <span className="font-mono text-foreground">/pagamentos-pix</span> é deste relatório administrativo. Cada pessoa informa nome, valor e mensagem e recebe um QR Code próprio.</p>
      <PublicPaymentLink url={`${getSiteUrl()}/pagar`} />
      <p className="text-xs text-muted">O nome é informado pelo cliente, não verificado pelo banco.</p>
      <p className="text-xs text-muted">O link aceita até 8 novas cobranças por hora. O limite é compartilhado com os pedidos da loja e pode ser menor se a cota da EclipsePay já tiver sido usada.</p>
    </Card>
    <Card className="overflow-x-auto p-5">
      <h2 className="mb-4 text-lg font-semibold">Pagamentos do link público</h2>
      <table className="w-full text-left text-sm"><thead><tr><th className="p-3">Nome informado</th><th className="p-3">Detalhes / mensagem</th><th className="p-3">Valor pago</th><th className="p-3">Valor recebido</th><th className="p-3">Situação</th><th className="p-3">Data</th></tr></thead><tbody>
        {(publicPayments.data ?? []).map((row) => <tr key={row.id} className="border-t border-white/10">
          <td className="p-3 font-medium">{row.payer_name}</td>
          <td className="max-w-xs whitespace-pre-wrap break-words p-3 text-muted">{row.payer_details || "—"}</td>
          <td className="p-3">{row.operation_status === "completed" ? money(row.amount_cents) : "—"}</td>
          <td className="p-3">{row.operation_status === "completed" ? row.net_cents === null ? "A confirmar" : money(row.net_cents) : "—"}</td>
          <td className="p-3">{status[row.operation_status] ?? row.operation_status}</td>
          <td className="p-3">{new Date(row.confirmed_at ?? row.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
        </tr>)}
        {!publicPayments.data?.length && <tr><td colSpan={6} className="p-6 text-center text-muted">Ainda não há pagamentos pelo link público.</td></tr>}
      </tbody></table>
    </Card>
    <Card className="p-5"><p className="text-sm text-muted">Um estorno não libera nova entrega e não devolve estoque ou saldo automaticamente. Confira o pedido, o ticket e a operação na EclipsePay antes de qualquer ajuste manual.</p></Card>
    <Card className="overflow-x-auto p-5"><table className="w-full text-left text-sm"><thead><tr><th className="p-3">Pedido</th><th className="p-3">Tipo</th><th className="p-3">Valor</th><th className="p-3">Líquido recebido</th><th className="p-3">Situação</th><th className="p-3">Criado em</th></tr></thead><tbody>
      {(orders.data ?? []).map((row) => <tr key={row.order_id} className="border-t border-white/10"><td className="p-3 font-mono text-xs">{row.order_id}</td><td className="p-3">{kinds[row.order_kind]}</td><td className="p-3">{money(row.amount_cents)}</td><td className="p-3">{row.net_cents === null ? "A confirmar" : money(row.net_cents)}</td><td className={`p-3 ${row.review_required ? "text-red-400" : ""}`}>{status[row.operation_status]}</td><td className="p-3">{new Date(row.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td></tr>)}
      {!orders.data?.length && <tr><td colSpan={6} className="p-6 text-center text-muted">Nenhuma cobrança EclipsePay registrada ainda.</td></tr>}
    </tbody></table></Card>
  </div>;
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) / 100);
}
