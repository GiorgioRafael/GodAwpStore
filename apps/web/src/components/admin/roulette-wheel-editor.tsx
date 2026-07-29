"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { formatBrl } from "@godawp/domain";
import { saveRouletteWheelAction } from "@/app/actions/roulette-wheel";
import { ActionFeedback, initialAdminActionState } from "./action-feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Input, Select } from "@/components/ui/form-field";
import { MAXIMUM_WHEEL_SLOTS, rouletteSlotKeys } from "@/lib/roulette/demo";
import { HIGHLIGHTED_PRIZE_COUNT, highlightedPrizeValues } from "@/lib/roulette/wheel";
import {
  slotChanceShares,
  wheelEconomics,
  wheelVerdict,
  type WheelSlotDraft,
} from "@/lib/roulette/wheel-economics";

export type WheelSlot = WheelSlotDraft & {
  stockQuantity: number;
  heldUnits: number;
  retiredUnits: number;
  archived: boolean;
};

export type WheelCandidate = {
  id: string;
  name: string;
  valueCents: number;
  stockQuantity: number;
};

/**
 * The wheel, editable. Every number the decision depends on — the odds, what
 * the wheel pays back, what is left per spin — is recomputed as the operator
 * types, because deciding a payout from a saved number means saving first and
 * finding out afterwards.
 */
export function RouletteWheelEditor({
  slots,
  candidates,
  markupBps,
  feeBps,
}: {
  slots: WheelSlot[];
  candidates: WheelCandidate[];
  markupBps: number;
  feeBps: number;
}) {
  const [draft, setDraft] = useState(slots);
  const [state, action, pending] = useActionState(
    saveRouletteWheelAction,
    initialAdminActionState,
  );

  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const economics = useMemo(
    () => wheelEconomics(draft, { markupBps, feeBps }),
    [draft, markupBps, feeBps],
  );
  const verdict = useMemo(
    () => wheelVerdict(economics, { markupBps }),
    [economics, markupBps],
  );
  const highlighted = useMemo(
    () => highlightedPrizeValues(draft.map((slot) => slot.valueCents)),
    [draft],
  );
  // Arredondar cada fatia sozinha deixa a coluna somando 99,98%, e aí não dá
  // para saber se é o arredondamento ou um erro seu.
  const shares = useMemo(() => slotChanceShares(draft), [draft]);

  function addSlot() {
    setDraft((current) => {
      if (current.length >= MAXIMUM_WHEEL_SLOTS) return current;
      const taken = new Set(current.map((slot) => slot.prizeKey));
      const free = rouletteSlotKeys(MAXIMUM_WHEEL_SLOTS).find((key) => !taken.has(key));
      if (!free) return current;
      const cheapest = [...candidates].sort((a, b) => a.valueCents - b.valueCents)[0];
      if (!cheapest) return current;
      return [
        ...current,
        {
          prizeKey: free,
          productId: cheapest.id,
          productName: cheapest.name,
          valueCents: cheapest.valueCents,
          stockQuantity: cheapest.stockQuantity,
          // Metade do peso médio: entra sem virar a roda de cabeça para baixo.
          drawWeight: Math.max(
            Math.round(
              current.reduce((sum, slot) => sum + slot.drawWeight, 0) /
                Math.max(current.length, 1) /
                2,
            ),
            1,
          ),
          heldUnits: 0,
          retiredUnits: 0,
          archived: false,
        },
      ];
    });
  }

  function removeSlot(prizeKey: string) {
    setDraft((current) => current.filter((slot) => slot.prizeKey !== prizeKey));
  }

  function setProduct(prizeKey: string, productId: string) {
    const product = byId.get(productId);
    setDraft((current) =>
      current.map((slot) =>
        slot.prizeKey === prizeKey
          ? {
              ...slot,
              productId,
              productName: product?.name ?? slot.productName,
              valueCents: product?.valueCents ?? 0,
              stockQuantity: product?.stockQuantity ?? 0,
              archived: false,
            }
          : slot,
      ),
    );
  }

  function setWeight(prizeKey: string, raw: string) {
    const weight = Number(raw.replace(",", "."));
    setDraft((current) =>
      current.map((slot) =>
        slot.prizeKey === prizeKey
          ? { ...slot, drawWeight: Number.isFinite(weight) ? Math.max(weight, 0) : 0 }
          : slot,
      ),
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Itens da roleta
          </h2>
          <p className="mt-1 text-sm text-muted">
            É aqui que se troca o prêmio de cada fatia e a frequência com que ele sai. Os números
            recalculam enquanto você mexe — o que aparece é o que vale depois de salvar.
          </p>
        </div>
        <Badge tone={verdict.tone === "success" ? "success" : verdict.tone === "warning" ? "warning" : "danger"}>
          {(economics.returnBps / 100).toFixed(1)}% ao jogador
        </Badge>
      </CardHeader>
      <form action={action}>
        <CardContent className="space-y-4 pt-5">
          <ActionFeedback state={state} />

          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-[0.12em] text-muted">
                  <th className="pb-2 pr-3 font-medium">Fatia</th>
                  <th className="pb-2 pr-3 font-medium">Item sorteado</th>
                  <th className="pb-2 pr-3 font-medium">Valor na loja</th>
                  <th className="pb-2 pr-3 font-medium">Peso</th>
                  <th className="pb-2 pr-3 font-medium">Chance</th>
                  <th className="pb-2 pr-3 font-medium">Estoque</th>
                  <th className="pb-2 font-medium">
                    <span className="sr-only">Remover</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {draft.map((slot, index) => {
                  const chance = (shares[index] ?? 0) / 100;
                  return (
                    <tr key={slot.prizeKey} className="border-b border-border/60 last:border-b-0">
                      <td className="py-3 pr-3">
                        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                          {highlighted.has(slot.valueCents) ? (
                            <Sparkles
                              aria-label="Recebe o destaque dourado"
                              className="size-3.5 text-gold"
                            />
                          ) : null}
                          {slot.prizeKey.replace("premio_", "#")}
                        </span>
                      </td>
                      <td className="py-3 pr-3">
                        <Select
                          name={`product-${slot.prizeKey}`}
                          aria-label={`Produto da fatia ${slot.prizeKey}`}
                          className="h-10 min-w-[16rem]"
                          value={slot.productId}
                          onChange={(event) => setProduct(slot.prizeKey, event.target.value)}
                        >
                          {slot.archived ? (
                            <option value={slot.productId}>{slot.productName} (arquivado)</option>
                          ) : null}
                          {candidates.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.name} — {formatBrl(candidate.valueCents)}
                            </option>
                          ))}
                        </Select>
                        {slot.heldUnits > 0 || slot.retiredUnits > 0 ? (
                          <p className="mt-1 text-xs text-muted">
                            {slot.heldUnits > 0 ? `${slot.heldUnits} un. deste item` : null}
                            {slot.heldUnits > 0 && slot.retiredUnits > 0 ? " · " : null}
                            {slot.retiredUnits > 0
                              ? `${slot.retiredUnits} un. de itens anteriores`
                              : null}{" "}
                            já ganhas — cada uma vale o que valia quando saiu
                          </p>
                        ) : null}
                      </td>
                      <td className="py-3 pr-3 tabular-nums text-muted-strong">
                        {formatBrl(slot.valueCents)}
                      </td>
                      <td className="py-3 pr-3">
                        <Input
                          name={`weight-${slot.prizeKey}`}
                          aria-label={`Peso da fatia ${slot.prizeKey}`}
                          className="h-10 w-28 tabular-nums"
                          inputMode="numeric"
                          value={slot.drawWeight}
                          onChange={(event) => setWeight(slot.prizeKey, event.target.value)}
                        />
                      </td>
                      <td className="py-3 pr-3 tabular-nums font-medium text-foreground">
                        {chance.toFixed(2)}%
                      </td>
                      <td
                        className={cn(
                          "py-3 pr-3 tabular-nums",
                          slot.stockQuantity > 0 ? "text-muted" : "text-danger",
                        )}
                      >
                        {slot.stockQuantity}
                      </td>
                      <td className="py-3">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={draft.length <= 1}
                          onClick={() => removeSlot(slot.prizeKey)}
                          title={
                            draft.length <= 1
                              ? "A roda precisa de ao menos uma fatia"
                              : "Tirar da roda. Quem já ganhou continua com o prêmio e ainda pode vender ou resgatar."
                          }
                          aria-label={`Remover a fatia ${slot.prizeKey}`}
                        >
                          <Trash2 aria-hidden="true" className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={addSlot}
              disabled={draft.length >= MAXIMUM_WHEEL_SLOTS || candidates.length === 0}
              title={
                draft.length >= MAXIMUM_WHEEL_SLOTS
                  ? `A roda vai até ${MAXIMUM_WHEEL_SLOTS} fatias`
                  : "Adicionar uma fatia"
              }
            >
              <Plus aria-hidden="true" className="size-4" />
              Adicionar fatia
            </Button>
            <p className="text-xs text-muted">
              {draft.length} de {MAXIMUM_WHEEL_SLOTS} fatias · as chances sempre somam 100%
            </p>
          </div>

          <div
            className={cn(
              "rounded-xl border px-4 py-3.5",
              verdict.tone === "success"
                ? "border-success/25 bg-success/[0.06]"
                : verdict.tone === "warning"
                  ? "border-warning/25 bg-warning/[0.06]"
                  : "border-danger/25 bg-danger/[0.06]",
            )}
          >
            <p className="text-sm font-medium text-foreground">{verdict.title}</p>
            <p className="mt-1 text-xs leading-5 text-muted">{verdict.detail}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Figure
              label="Prêmio médio por giro"
              value={formatBrl(Math.round(economics.expectedValueCents))}
              detail="Valor de tabela que a roda entrega"
            />
            <Figure
              label="Custo médio por giro"
              value={formatBrl(Math.round(economics.expectedCostCents))}
              detail={`Preço dividido pelo markup de ${(markupBps / 100).toFixed(0)}%`}
            />
            <Figure
              label="Sobra por giro"
              value={formatBrl(Math.round(economics.marginCents))}
              detail={`Prejuízo a partir de ${(economics.breakEvenBps / 100).toFixed(1)}%`}
            />
          </div>

          <p className="text-xs leading-5 text-muted">
            O valor de cada prêmio é o preço do item{" "}
            <Link href="/catalogo/produtos" className="font-medium text-gold hover:underline">
              no catálogo
            </Link>{" "}
            — a roleta sempre puxa de lá, então não existe preço só-da-roleta para sair do lugar.
            Mudou o preço na loja, mudou aqui, e o RTP acompanha. Prêmio que alguém já ganhou mantém
            o valor de quando foi ganho.
          </p>
          <p className="text-xs leading-5 text-muted">
            Trocar o item de uma fatia, ou tirar a fatia da roda, não mexe em nada que já foi ganho:
            cada prêmio no inventário guarda o produto e o preço de quando saiu, e continua
            aparecendo, vendível e resgatável para o jogador exatamente como estava.
          </p>
          <p className="text-xs leading-5 text-muted">
            As {HIGHLIGHTED_PRIZE_COUNT} fatias mais caras ganham a moldura dourada na roleta e no
            overlay, e são elas que soltam confete. O destaque acompanha o que você põe aqui — não
            existe valor fixo.
          </p>
        </CardContent>
        <CardFooter className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted">
            Peso total {economics.totalWeight.toLocaleString("pt-BR")} · a chance é o peso da fatia
            dividido por ele
          </p>
          <Button type="submit" disabled={pending}>
            {pending ? "Salvando..." : "Salvar roda"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function Figure({
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
