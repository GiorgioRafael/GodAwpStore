"use client";

import { useActionState, useId } from "react";
import { formatBrl } from "@godawp/domain";
import { saveRouletteRatesAction } from "@/app/actions/roulette-metrics";
import { ActionFeedback, fieldError, initialAdminActionState } from "./action-feedback";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form-field";

/**
 * The two rates the result is estimated from. Neither touches the wheel: they
 * only tell the panel what a prize really cost and what the provider kept.
 */
export function RouletteRatesForm({
  markupBps,
  feeBps,
  saleRateBps,
}: {
  markupBps: number;
  feeBps: number;
  saleRateBps: number;
}) {
  const formId = useId();
  const [state, action, pending] = useActionState(
    saveRouletteRatesAction,
    initialAdminActionState,
  );

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold tracking-tight">Premissas do cálculo</h2>
        <p className="mt-1 text-sm text-muted">
          O custo de um prêmio sai do preço de tabela dividido pelo markup. Mudar estes números
          altera o que o painel estima, nunca o que o jogador vê ou recebe.
        </p>
      </CardHeader>
      <form action={action}>
        <CardContent className="space-y-4 pt-5">
          <ActionFeedback state={state} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Markup sobre o custo"
              htmlFor={`${formId}-markup`}
              hint="Quanto você cobra acima do que pagou"
              error={fieldError(state, "markupPercent")}
            >
              <Input
                id={`${formId}-markup`}
                name="markupPercent"
                inputMode="decimal"
                defaultValue={formatPercent(markupBps)}
                aria-describedby={`${formId}-markup-example`}
              />
            </Field>
            <Field
              label="Taxa do LivePix"
              htmlFor={`${formId}-fee`}
              hint="Retida em cada Pix recebido"
              error={fieldError(state, "feePercent")}
            >
              <Input
                id={`${formId}-fee`}
                name="feePercent"
                inputMode="decimal"
                defaultValue={formatPercent(feeBps)}
              />
            </Field>
          </div>
          <p id={`${formId}-example`} className="text-xs leading-5 text-muted">
            Com {formatPercent(markupBps)}% de markup, um item que você comprou por{" "}
            {formatBrl(100)} aparece na roleta valendo {formatBrl(100 + markupBps / 100)}.
          </p>
          <div className="space-y-2 rounded-xl border border-warning/20 bg-warning/[0.05] px-4 py-3.5">
            <Field
              label="Recompra do prêmio"
              htmlFor={`${formId}-sale`}
              hint="Moedas devolvidas na venda"
              error={fieldError(state, "salePercent")}
            >
              <Input
                id={`${formId}-sale`}
                name="salePercent"
                inputMode="decimal"
                defaultValue={formatPercent(saleRateBps)}
              />
            </Field>
            <p className="text-xs leading-5 text-muted">
              Esta muda o jogo, não só a conta: o valor é lido na hora da venda, então baixá-la tira
              valor de todo prêmio que já está no inventário de alguém. Um prêmio de{" "}
              {formatBrl(100)} devolve {formatBrl(Math.round(saleRateBps))} hoje.
            </p>
          </div>
        </CardContent>
        <CardFooter className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted">Vale só para a roleta.</p>
          <Button type="submit" disabled={pending}>
            {pending ? "Salvando..." : "Salvar premissas"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function formatPercent(bps: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(bps / 100);
}
