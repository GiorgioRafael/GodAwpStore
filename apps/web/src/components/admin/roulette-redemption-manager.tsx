"use client";

import { CheckCircle2, MessageSquare, PackageCheck, RefreshCw, XCircle } from "lucide-react";
import { useActionState } from "react";

import {
  retryRouletteRedemptionTicketAction,
  settleRouletteRedemptionAction,
} from "@/app/actions/roulette-redemptions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableEmptyRow, TableShell } from "@/components/ui/table-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCoins } from "@/lib/roulette/demo";

export type AdminRouletteRedemption = {
  id: string;
  discordUserId: string;
  productName: string;
  valueCents: number;
  status: "pending" | "delivered" | "cancelled";
  ticketStatus: "pending" | "creating" | "open" | "failed";
  ticketChannelId: string | null;
  ticketError: string | null;
  guildDiscordId: string | null;
  productStock: number | null;
  createdAt: string;
};

const STATUS_LABEL: Record<AdminRouletteRedemption["status"], string> = {
  pending: "Aguardando entrega",
  delivered: "Entregue",
  cancelled: "Cancelado",
};

const TICKET_LABEL: Record<AdminRouletteRedemption["ticketStatus"], string> = {
  pending: "Ticket pendente",
  creating: "Criando ticket",
  open: "Ticket aberto",
  failed: "Ticket falhou",
};

export function RouletteRedemptionManager({
  redemptions,
}: {
  redemptions: AdminRouletteRedemption[];
}) {
  const [settleState, settle, settlePending] = useActionState(
    settleRouletteRedemptionAction,
    { ok: true, message: "" },
  );
  const [retryState, retry, retryPending] = useActionState(
    retryRouletteRedemptionTicketAction,
    { ok: true, message: "" },
  );
  const feedback = settleState.message || retryState.message;
  const feedbackOk = settleState.message ? settleState.ok : retryState.ok;

  if (!redemptions.length) {
    return (
      <EmptyState
        icon={PackageCheck}
        title="Nenhum resgate pedido"
        description="Quando um jogador resgatar um prêmio da roleta, ele aparece aqui com o ticket do Discord para a entrega."
      />
    );
  }

  return (
    <div className="space-y-4">
      {feedback ? (
        <p
          role="status"
          className={`rounded-xl border px-4 py-3 text-sm ${
            feedbackOk
              ? "border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-200"
              : "border-rose-400/25 bg-rose-400/[0.07] text-rose-200"
          }`}
        >
          {feedback}
        </p>
      ) : null}

      <TableShell
        caption="Resgates da roleta"
        columns={["Item", "Jogador", "Estoque", "Situação", "Ticket", "Ações"]}
      >
        {redemptions.length === 0 ? (
          <TableEmptyRow colSpan={6}>Nenhum resgate.</TableEmptyRow>
        ) : null}
        {redemptions.map((redemption) => (
          <tr key={redemption.id} className="border-b border-border last:border-b-0">
            <td className="px-5 py-4">
              <p className="font-medium text-foreground">{redemption.productName}</p>
              <p className="mt-0.5 text-xs text-muted">
                {formatCoins(redemption.valueCents)} moedas ·{" "}
                {new Date(redemption.createdAt).toLocaleString("pt-BR")}
              </p>
            </td>
            <td className="px-5 py-4 text-sm text-muted-strong">
              <code className="text-xs">{redemption.discordUserId}</code>
            </td>
            <td className="px-5 py-4 text-sm">
              {redemption.productStock === null ? (
                <span className="text-muted">—</span>
              ) : (
                <span
                  className={
                    redemption.productStock > 0 ? "text-foreground" : "text-rose-300"
                  }
                >
                  {redemption.productStock} un
                </span>
              )}
            </td>
            <td className="px-5 py-4">
              <Badge tone={redemption.status === "delivered" ? "success" : redemption.status === "cancelled" ? "neutral" : "warning"}>
                {STATUS_LABEL[redemption.status]}
              </Badge>
            </td>
            <td className="px-5 py-4">
              <div className="flex flex-col gap-1">
                <Badge tone={redemption.ticketStatus === "open" ? "success" : redemption.ticketStatus === "failed" ? "danger" : "neutral"}>
                  {TICKET_LABEL[redemption.ticketStatus]}
                </Badge>
                {redemption.ticketChannelId && redemption.guildDiscordId ? (
                  <a
                    href={`https://discord.com/channels/${redemption.guildDiscordId}/${redemption.ticketChannelId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-gold hover:underline"
                  >
                    <MessageSquare aria-hidden="true" className="size-3" />
                    Abrir no Discord
                  </a>
                ) : null}
                {redemption.ticketError ? (
                  <span className="text-xs text-rose-300">{redemption.ticketError}</span>
                ) : null}
              </div>
            </td>
            <td className="px-5 py-4">
              <div className="flex flex-wrap gap-2">
                {redemption.status === "pending" ? (
                  <>
                    <form action={settle}>
                      <input type="hidden" name="redemptionId" value={redemption.id} />
                      <input type="hidden" name="status" value="delivered" />
                      <Button type="submit" size="sm" disabled={settlePending}>
                        <CheckCircle2 aria-hidden="true" className="size-4" />
                        Entregue
                      </Button>
                    </form>
                    <form action={settle}>
                      <input type="hidden" name="redemptionId" value={redemption.id} />
                      <input type="hidden" name="status" value="cancelled" />
                      <Button
                        type="submit"
                        size="sm"
                        variant="secondary"
                        disabled={settlePending}
                      >
                        <XCircle aria-hidden="true" className="size-4" />
                        Cancelar
                      </Button>
                    </form>
                  </>
                ) : null}
                {redemption.ticketStatus !== "open" ? (
                  <form action={retry}>
                    <input type="hidden" name="redemptionId" value={redemption.id} />
                    <Button
                      type="submit"
                      size="sm"
                      variant="secondary"
                      disabled={retryPending}
                    >
                      <RefreshCw aria-hidden="true" className="size-4" />
                      Reabrir ticket
                    </Button>
                  </form>
                ) : null}
              </div>
            </td>
          </tr>
        ))}
      </TableShell>
    </div>
  );
}
