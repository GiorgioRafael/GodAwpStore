"use client";

import { useActionState, useId } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, Save } from "lucide-react";

import {
  saveMasterCommissionAction,
  type DiscordBotsActionState,
} from "@/app/admin/discordbots/actions";
import { formatCommissionForInput } from "@/components/admin/admin-format";

const initialState: DiscordBotsActionState = { ok: false, message: "" };

export function MasterCommissionForm({ globalCommissionBps }: { globalCommissionBps: number }) {
  const [state, formAction, pending] = useActionState(saveMasterCommissionAction, initialState);
  const inputId = useId();
  const error = state.fieldErrors?.commissionPercent?.[0];

  return (
    <section
      id="comissao"
      aria-labelledby="comissao-plataforma"
      className="rounded-2xl border border-slate-800 bg-[#0b121c] p-5 shadow-[0_22px_70px_rgba(0,0,0,.2)] sm:p-6"
    >
      <h2 id="comissao-plataforma" className="text-base font-semibold tracking-tight text-white sm:text-lg">
        Comissão da plataforma
      </h2>
      <p className="mt-1 text-sm leading-6 text-slate-500">
        Taxa da 101Devs aplicada ao faturamento bruto consolidado de todos os serviços.
      </p>

      <form action={formAction} className="mt-6 space-y-4">
        {state.message ? (
          <div
            role={state.ok ? "status" : "alert"}
            className={
              state.ok
                ? "flex items-start gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2.5 text-xs text-emerald-300"
                : "flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2.5 text-xs text-rose-300"
            }
          >
            {state.ok ? (
              <CheckCircle2 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            ) : (
              <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            )}
            {state.message}
          </div>
        ) : null}

        <label htmlFor={inputId} className="block text-sm font-medium text-slate-300">
          Percentual de comissão
        </label>
        <div className="relative">
          <input
            key={globalCommissionBps}
            id={inputId}
            name="commissionPercent"
            inputMode="decimal"
            min="0"
            max="100"
            step="0.01"
            defaultValue={formatCommissionForInput(globalCommissionBps)}
            required
            aria-invalid={Boolean(error)}
            aria-describedby={`${inputId}-help`}
            className="h-13 w-full rounded-xl border border-slate-700 bg-[#080f18] px-4 pr-11 text-lg font-medium text-white outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-500/10"
          />
          <span aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-400">
            %
          </span>
        </div>
        <p id={`${inputId}-help`} className={error ? "text-xs text-rose-300" : "text-xs leading-5 text-slate-500"}>
          {error ?? "Aplicada automaticamente sobre o faturamento bruto confirmado da GWStore e da Loja TH."}
        </p>

        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white shadow-[0_12px_35px_rgba(124,58,237,.28)] transition-colors hover:bg-violet-500 disabled:cursor-wait disabled:opacity-65"
        >
          {pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Save aria-hidden="true" className="size-4" />}
          {pending ? "Salvando..." : "Salvar alteração"}
        </button>
      </form>
    </section>
  );
}
