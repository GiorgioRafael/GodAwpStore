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
  updatedAt: string | null;
}

export function PlatformSettingsForm({ globalCommissionBps, updatedAt }: PlatformSettingsFormProps) {
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
          <p id={`${formId}-commission-help`} className="rounded-xl border border-border bg-surface-muted p-3 text-xs leading-5 text-muted">
            Uma exceção definida na whitelist prevalece sobre esta taxa. O valor é armazenado em pontos-base para evitar arredondamento.
          </p>
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
