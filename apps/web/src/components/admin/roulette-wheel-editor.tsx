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
  slotBundleValueCents,
  wheelEconomics,
  wheelVerdict,
  type WheelSlotDraft,
} from "@/lib/roulette/wheel-economics";

export type WheelSlot = WheelSlotDraft & {
  stockQuantity: number;
  heldUnits: number;
  retiredUnits: number;
  archived: boolean;
  available: boolean;
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
  saleRateBps,
}: {
  slots: WheelSlot[];
  candidates: WheelCandidate[];
  markupBps: number;
  feeBps: number;
  saleRateBps: number;
}) {
  const [draft, setDraft] = useState(slots);
  const [state, action, pending] = useActionState(
    saveRouletteWheelAction,
    initialAdminActionState,
  );

  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const economics = useMemo(
    () => wheelEconomics(draft, { markupBps, feeBps, saleRateBps }),
    [draft, markupBps, feeBps, saleRateBps],
  );
  const verdict = useMemo(
    () => wheelVerdict(economics, { markupBps }),
    [economics, markupBps],
  );
  // O destaque compara o que a fatia entrega. Uma fatia de dez unidades baratas
  // pode valer mais que uma de uma cara, e é isso que o jogador vê.
  const highlighted = useMemo(
    () => highlightedPrizeValues(draft.map(slotBundleValueCents)),
    [draft],
  );
  // Arredondar cada fatia sozinha deixa a coluna somando 99,98%, e aí não dá
  // para saber se é o arredondamento ou um erro seu.
  const shares = useMemo(() => slotChanceShares(draft), [draft]);
  const unavailableSlots = useMemo(
    () => draft.filter((slot) => !slot.available),
    [draft],
  );

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
          quantity: 1,
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
          available: true,
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
              available: Boolean(product),
            }
          : slot,
      ),
    );
  }

  function setQuantity(prizeKey: string, raw: string) {
    const quantity = Number(raw.replace(",", "."));
    setDraft((current) =>
      current.map((slot) =>
        slot.prizeKey === prizeKey
          ? { ...slot, quantity: Number.isFinite(quantity) ? Math.max(Math.trunc(quantity), 0) : 0 }
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
            1. Monte os prêmios da roleta
          </h2>
          <p className="mt-1 text-sm text-muted">
            Escolha o item de cada fatia, informe quantas unidades o jogador recebe e ajuste o peso.
            A chance e a margem são calculadas automaticamente antes de salvar.
          </p>
        </div>
        <Badge tone={verdict.tone === "success" ? "success" : verdict.tone === "warning" ? "warning" : "danger"}>
          {(economics.returnBps / 100).toFixed(1)}% ao jogador
        </Badge>
      </CardHeader>
      <form action={action}>
        <CardContent className="space-y-4 pt-5">
          <ActionFeedback state={state} />

          {unavailableSlots.length > 0 ? (
            <div className="rounded-xl border border-danger/30 bg-danger/[0.06] px-4 py-3 text-sm text-danger">
              <p className="font-semibold">Troque {unavailableSlots.length} prêmio(s) antes de salvar</p>
              <p className="mt-1 leading-5 text-muted-strong">
                {unavailableSlots.map((slot) => slot.productName).join(", ")} não está à venda no catálogo.
                Escolha outro item ativo em cada fatia marcada. A roda atual não muda até você salvar.
              </p>
            </div>
          ) : null}

          <div className="grid gap-2 rounded-xl border border-border bg-surface-muted px-4 py-3 text-xs leading-5 text-muted sm:grid-cols-3">
            <p><strong className="text-foreground">1.</strong> Escolha o item entregue.</p>
            <p><strong className="text-foreground">2.</strong> Informe a quantidade do prêmio.</p>
            <p><strong className="text-foreground">3.</strong> Ajuste o peso; a chance sai sozinha.</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-[0.12em] text-muted">
                  <th className="pb-2 pr-3 font-medium">Fatia</th>
                  <th className="pb-2 pr-3 font-medium">Item entregue</th>
                  <th className="pb-2 pr-3 font-medium">Qtd. por prêmio</th>
                  <th className="pb-2 pr-3 font-medium">Valor do prêmio</th>
                  <th className="pb-2 pr-3 font-medium">Peso</th>
                  <th className="pb-2 pr-3 font-medium">Chance automática</th>
                  <th className="pb-2 pr-3 font-medium">Estoque atual</th>
                  <th className="pb-2 font-medium">
                    <span className="sr-only">Remover</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {draft.map((slot, index) => {
                  const chance = (shares[index] ?? 0) / 100;
                  const bundleCents = slotBundleValueCents(slot);
                  // Quantas voltas o estoque cobre: uma fatia de dez unidades
                  // esvazia o catálogo dez vezes mais rápido, e é o resgate que
                  // descobre isso se ninguém avisar antes.
                  const spinsCovered = Math.floor(slot.stockQuantity / Math.max(slot.quantity, 1));
                  return (
                    <tr key={slot.prizeKey} className="border-b border-border/60 last:border-b-0">
                      <td className="py-3 pr-3">
                        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                          {highlighted.has(bundleCents) ? (
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
                          {!slot.available ? (
                            <option value={slot.productId}>{slot.productName} (substitua: inativo)</option>
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
                        {!slot.available ? (
                          <p className="mt-1 text-xs font-medium text-danger">Este item não pode continuar na roda. Escolha outro item ativo.</p>
                        ) : null}
                      </td>
                      <td className="py-3 pr-3">
                        <Input
                          name={`quantity-${slot.prizeKey}`}
                          aria-label={`Quantidade da fatia ${slot.prizeKey}`}
                          className="h-10 w-20 tabular-nums"
                          inputMode="numeric"
                          value={slot.quantity}
                          onChange={(event) => setQuantity(slot.prizeKey, event.target.value)}
                        />
                      </td>
                      <td className="py-3 pr-3 tabular-nums text-muted-strong">
                        {formatBrl(bundleCents)}
                        {slot.quantity > 1 ? (
                          <span className="mt-0.5 block text-xs text-muted">
                            {slot.quantity} × {formatBrl(slot.valueCents)}
                          </span>
                        ) : null}
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
                          spinsCovered > 0 ? "text-muted" : "text-danger",
                        )}
                      >
                        {slot.stockQuantity}
                        {slot.quantity > 1 ? (
                          <span className="mt-0.5 block text-xs">
                            {spinsCovered} giro(s)
                          </span>
                        ) : null}
                      </td>
                      <td className="py-3">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={pending || draft.length <= 1}
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
              disabled={pending || draft.length >= MAXIMUM_WHEEL_SLOTS || candidates.length === 0}
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
              detail={`Prejuízo a partir de ${(economics.safeCeilingBps / 100).toFixed(1)}%`}
            />
          </div>

          {/* A recompra devolve moeda, e moeda compra giro. Sem estes dois
              números o operador só vê a margem de UM giro e não vê quantos
              giros um depósito paga — nem que acima de 100% ele paga infinitos. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Figure
              label="Moedas de volta por giro"
              value={`${(economics.coinReturnBps / 100).toFixed(1)}%`}
              tone={economics.coinReturnBps >= 10000 ? "danger" : undefined}
              detail={`${(economics.returnBps / 100).toFixed(1)}% de RTP × ${(saleRateBps / 100).toFixed(0)}% de recompra`}
            />
            <Figure
              label="Giros por moeda depositada"
              value={
                Number.isFinite(economics.spinsPerCoin)
                  ? economics.spinsPerCoin.toFixed(2)
                  : "∞"
              }
              tone={Number.isFinite(economics.spinsPerCoin) ? undefined : "danger"}
              detail={
                Number.isFinite(economics.spinsPerCoin)
                  ? `Se o jogador vender tudo de volta. O saldo acaba em ${(economics.recyclingCeilingBps / 100).toFixed(0)}% de RTP`
                  : "O saldo do jogador nunca acaba"
              }
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
            As alterações nas fatias só são persistidas ao salvar. Peso total{" "}
            {economics.totalWeight.toLocaleString("pt-BR")} · a chance é o peso da fatia dividido por ele
          </p>
          <Button type="submit" disabled={pending || unavailableSlots.length > 0}>
            {pending ? "Salvando..." : unavailableSlots.length > 0 ? "Troque os itens indisponíveis" : "Salvar roda"}
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
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "danger";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3.5",
        tone === "danger"
          ? "border-danger/30 bg-danger/[0.06]"
          : "border-border bg-surface-muted/35",
      )}
    >
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted">{label}</p>
      <p
        className={cn(
          "mt-2 text-lg font-semibold tracking-[-0.03em]",
          tone === "danger" ? "text-danger" : "text-foreground",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs leading-5 text-muted">{detail}</p>
    </div>
  );
}
