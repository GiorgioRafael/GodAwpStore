"use client";

import { useActionState, useId } from "react";
import { LoaderCircle, Save } from "lucide-react";

import { savePlatformSettingsAction } from "@/app/actions/admin";
import { ActionFeedback, fieldError, initialAdminActionState } from "@/components/admin/action-feedback";
import { formatCommissionForInput, formatDateTime } from "@/components/admin/admin-format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form-field";

interface PlatformSettingsFormProps {
  globalCommissionBps: number;
  upsellEnabled: boolean;
  upsellDiscountBps: number;
  upsellStrategy: "automatic" | "best_seller" | "same_product";
  leadRecoveryEnabled: boolean;
  leadRecoveryDiscountBps: number;
  leadRecoveryDelayMinutes: number;
  updatedAt: string | null;
}

export function PlatformSettingsForm({
  globalCommissionBps,
  upsellEnabled,
  upsellDiscountBps,
  upsellStrategy,
  leadRecoveryEnabled,
  leadRecoveryDiscountBps,
  leadRecoveryDelayMinutes,
  updatedAt,
}: PlatformSettingsFormProps) {
  const [state, formAction, pending] = useActionState(
    savePlatformSettingsAction,
    initialAdminActionState,
  );
  const formId = useId();

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold tracking-tight">Regras comerciais</h2>
        <p className="mt-1 text-sm leading-6 text-muted">
          Configuração central usada para calcular a comissão efetiva de cada parceiro.
        </p>
      </CardHeader>
      <form id={formId} action={formAction}>
        <CardContent className="space-y-5 pt-5">
          <ActionFeedback state={state} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Moeda" htmlFor={`${formId}-currency`} hint="Fixa nesta versão">
              <Select id={`${formId}-currency`} value="BRL" disabled>
                <option value="BRL">BRL — Real brasileiro</option>
              </Select>
            </Field>
            <Field
              label="Comissão global"
              htmlFor={`${formId}-commission`}
              hint="0% a 100%"
              error={
                fieldError(state, "globalCommissionBps") ??
                fieldError(state, "globalCommissionPercent")
              }
            >
              <div className="relative">
                <Input
                  id={`${formId}-commission`}
                  name="globalCommissionPercent"
                  inputMode="decimal"
                  defaultValue={formatCommissionForInput(globalCommissionBps)}
                  className="pr-10"
                  required
                  aria-describedby={`${formId}-commission-help`}
                />
                <span aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">%</span>
              </div>
            </Field>
          </div>
          <div className="space-y-4 rounded-xl border border-violet-400/20 bg-violet-400/[0.035] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Recuperação de carrinho</p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  Envia uma oferta privada depois que um QR Pix acima de R$ 5 expira sem pagamento.
                </p>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-muted-strong">
                <input
                  type="checkbox"
                  name="leadRecoveryEnabled"
                  defaultChecked={leadRecoveryEnabled}
                  className="size-4 accent-violet-400"
                />
                Ativo
              </label>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Desconto de recuperação"
                htmlFor={`${formId}-lead-recovery-discount`}
                hint="Máximo de 5%"
                error={
                  fieldError(state, "leadRecoveryDiscountBps") ??
                  fieldError(state, "leadRecoveryDiscountPercent")
                }
              >
                <div className="relative">
                  <Input
                    id={`${formId}-lead-recovery-discount`}
                    name="leadRecoveryDiscountPercent"
                    inputMode="decimal"
                    defaultValue={formatCommissionForInput(leadRecoveryDiscountBps)}
                    min="0.01"
                    max="5"
                    step="0.01"
                    className="pr-10"
                    required
                  />
                  <span aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">%</span>
                </div>
              </Field>
              <Field
                label="Espera após o vencimento"
                htmlFor={`${formId}-lead-recovery-delay`}
                hint="0 a 1.440 minutos"
                error={fieldError(state, "leadRecoveryDelayMinutes")}
              >
                <div className="relative">
                  <Input
                    id={`${formId}-lead-recovery-delay`}
                    name="leadRecoveryDelayMinutes"
                    type="number"
                    min="0"
                    max="1440"
                    step="1"
                    defaultValue={leadRecoveryDelayMinutes}
                    className="pr-20"
                    required
                  />
                  <span aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">minutos</span>
                </div>
              </Field>
            </div>
            <p className="text-xs leading-5 text-muted">
              A oferta dura 24 horas, vale uma única vez e compõe sobre o valor final depois de ranking, booster e upsell. O aceite cria outro pedido e outro QR Pix.
            </p>
          </div>
          <p id={`${formId}-commission-help`} className="rounded-xl border border-border bg-surface-muted p-3 text-xs leading-5 text-muted">
            Se um parceiro tiver comissão própria cadastrada na Whitelist, a dele vale no lugar desta.
          </p>
          <div className="space-y-4 rounded-xl border border-gold/20 bg-gold/[0.035] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Oferta adicional no checkout</p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  Aparece antes do Pix e reserva a unidade extra apenas quando o cliente decide.
                </p>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-muted-strong">
                <input
                  type="checkbox"
                  name="upsellEnabled"
                  defaultChecked={upsellEnabled}
                  className="size-4 accent-[#d7ad42]"
                />
                Ativo
              </label>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Desconto do item extra"
                htmlFor={`${formId}-upsell-discount`}
                hint="Máximo de 5%"
                error={
                  fieldError(state, "upsellDiscountBps") ??
                  fieldError(state, "upsellDiscountPercent")
                }
              >
                <div className="relative">
                  <Input
                    id={`${formId}-upsell-discount`}
                    name="upsellDiscountPercent"
                    inputMode="decimal"
                    defaultValue={formatCommissionForInput(upsellDiscountBps)}
                    min="0.01"
                    max="5"
                    step="0.01"
                    className="pr-10"
                    required
                  />
                  <span aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">%</span>
                </div>
              </Field>
              <Field
                label="Produto oferecido"
                htmlFor={`${formId}-upsell-strategy`}
                error={fieldError(state, "upsellStrategy")}
              >
                <Select
                  id={`${formId}-upsell-strategy`}
                  name="upsellStrategy"
                  defaultValue={upsellStrategy}
                >
                  <option value="automatic">Automático — mais vendido elegível</option>
                  <option value="best_seller">Mais vendido</option>
                  <option value="same_product">Um dos itens do carrinho</option>
                </Select>
              </Field>
            </div>
            <p className="text-xs leading-5 text-muted">
              O desconto vale só para uma unidade extra, não acumula com ranking ou booster e a oferta expira em 5 minutos.
            </p>
          </div>
          <Field label="Fuso de exibição" htmlFor={`${formId}-timezone`} hint="Timestamps salvos em UTC">
            <Input id={`${formId}-timezone`} value="America/Sao_Paulo" disabled readOnly />
          </Field>
        </CardContent>
        <CardFooter className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">
            {updatedAt ? `Última atualização: ${formatDateTime(updatedAt)}` : "Ainda não atualizada"}
          </p>
          <Button type="submit" disabled={pending}>
            {pending ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Save aria-hidden="true" className="size-4" />
            )}
            {pending ? "Salvando..." : "Salvar alterações"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
