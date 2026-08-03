"use client";

import { useActionState, useMemo, useState } from "react";
import { formatBrl } from "@godawp/domain";
import {
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Link2,
  LoaderCircle,
  Pencil,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";

import {
  saveBusinessAdminUrlAction,
  type DiscordBotsActionState,
} from "@/app/admin/discordbots/actions";
import { formatCommission } from "@/components/admin/admin-format";
import type { DiscordBotCompany } from "@/lib/data/discord-bots-dashboard";

type StatusFilter = "all" | "online" | "attention";

const initialState: DiscordBotsActionState = { ok: false, message: "" };

function formatActivity(value: string | null) {
  if (!value) return "Nenhuma interação registrada";
  return `Visto ${new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value))}`;
}

function healthClasses(tone: DiscordBotCompany["health"]["tone"]) {
  if (tone === "success") return "bg-emerald-400 text-emerald-400";
  if (tone === "warning") return "bg-amber-400 text-amber-300";
  if (tone === "danger") return "bg-rose-400 text-rose-300";
  return "bg-slate-500 text-slate-300";
}

function AdminUrlEditor({ company, onClose }: { company: DiscordBotCompany; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(saveBusinessAdminUrlAction, initialState);
  const error = state.fieldErrors?.adminPanelUrl?.[0];

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="presentation" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="editar-link-titulo"
        onMouseDown={(event) => event.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-slate-700 bg-[#0b121c] p-5 shadow-2xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id="editar-link-titulo" className="text-lg font-semibold text-white">
              Painel de {company.companyName}
            </h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Cadastre o endereço HTTPS do painel administrativo individual da empresa.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-lg border border-slate-700 text-slate-400 transition hover:text-white"
            aria-label="Fechar"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <form action={formAction} className="mt-6 space-y-4">
          <input type="hidden" name="companyId" value={company.companyId ?? ""} />
          {state.message ? (
            <div
              role={state.ok ? "status" : "alert"}
              className={
                state.ok
                  ? "flex items-start gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2.5 text-xs text-emerald-300"
                  : "flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2.5 text-xs text-rose-300"
              }
            >
              {state.ok ? <CheckCircle2 aria-hidden="true" className="size-3.5" /> : <CircleAlert aria-hidden="true" className="size-3.5" />}
              {state.message}
            </div>
          ) : null}
          <label className="block text-sm font-medium text-slate-300" htmlFor="business-admin-url">
            URL do painel individual
          </label>
          <div className="relative">
            <Link2 aria-hidden="true" className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
            <input
              id="business-admin-url"
              name="adminPanelUrl"
              type="url"
              inputMode="url"
              placeholder="https://empresa.com/admin"
              defaultValue={company.adminPanelUrl ?? ""}
              className="h-12 w-full rounded-xl border border-slate-700 bg-[#080f18] pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-violet-400 focus:ring-4 focus:ring-violet-500/10"
              aria-invalid={Boolean(error)}
              aria-describedby="business-admin-url-help"
            />
          </div>
          <p id="business-admin-url-help" className={error ? "text-xs text-rose-300" : "text-xs text-slate-500"}>
            {error ?? "Deixe vazio para remover o redirecionamento atual."}
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-lg border border-slate-700 px-4 text-sm font-medium text-slate-300 transition hover:border-slate-600 hover:text-white"
            >
              Fechar
            </button>
            <button
              type="submit"
              disabled={pending || !company.companyId}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-60"
            >
              {pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Link2 aria-hidden="true" className="size-4" />}
              {pending ? "Salvando..." : "Salvar link"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function BusinessBotsTable({ companies }: { companies: DiscordBotCompany[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [editing, setEditing] = useState<DiscordBotCompany | null>(null);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return companies.filter((company) => {
      const matchesQuery =
        !normalizedQuery ||
        company.companyName.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
        company.guildName.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
        company.discordGuildId.includes(normalizedQuery);
      const matchesStatus =
        status === "all" ||
        (status === "online" && company.health.label === "Online") ||
        (status === "attention" && company.status !== "active");
      return matchesQuery && matchesStatus;
    });
  }, [companies, query, status]);

  return (
    <section id="empresas" aria-labelledby="empresas-bots-titulo" className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0b121c] shadow-[0_22px_70px_rgba(0,0,0,.2)]">
      <div className="flex flex-col gap-4 border-b border-slate-800 p-5 sm:p-6 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h2 id="empresas-bots-titulo" className="text-base font-semibold tracking-tight text-white sm:text-lg">
            Empresas e bots
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {companies.length.toLocaleString("pt-BR")} {companies.length === 1 ? "bot conectado" : "bots conectados"}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative block sm:w-80">
            <span className="sr-only">Buscar empresa ou bot</span>
            <Search aria-hidden="true" className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar empresa ou bot"
              className="h-10 w-full rounded-lg border border-slate-700 bg-[#080f18] pl-10 pr-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-violet-400"
            />
          </label>
          <label className="relative block">
            <span className="sr-only">Filtrar status dos bots</span>
            <SlidersHorizontal aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
              className="h-10 appearance-none rounded-lg border border-slate-700 bg-[#080f18] py-0 pl-9 pr-8 text-sm text-slate-300 outline-none focus:border-violet-400"
            >
              <option value="all">Todos</option>
              <option value="online">Online</option>
              <option value="attention">Atenção</option>
            </select>
          </label>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] border-collapse text-left">
          <thead className="bg-white/[0.018] text-xs font-medium text-slate-400">
            <tr>
              <th className="px-6 py-3.5">Empresa</th>
              <th className="px-5 py-3.5">Bot / servidor</th>
              <th className="px-5 py-3.5">Status</th>
              <th className="px-5 py-3.5">Faturamento no mês</th>
              <th className="px-5 py-3.5">Comissão</th>
              <th className="px-6 py-3.5 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((company) => {
              const statusClasses = healthClasses(company.health.tone);
              return (
                <tr key={company.guildId} className="border-t border-slate-800/90 transition-colors hover:bg-white/[0.018]">
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-white">{company.companyName}</p>
                    <p className="mt-1 font-mono text-[11px] text-slate-600">Owner {company.ownerDiscordId}</p>
                  </td>
                  <td className="px-5 py-4">
                    <p className="text-sm font-medium text-slate-200">{company.guildName}</p>
                    <p className="mt-1 font-mono text-[11px] text-slate-600">{company.discordGuildId}</p>
                  </td>
                  <td className="px-5 py-4">
                    <div className={`inline-flex items-center gap-2 text-sm font-medium ${statusClasses.split(" ").at(-1)}`}>
                      <span className={`size-2 rounded-full ${statusClasses.split(" ")[0]}`} />
                      {company.health.label}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-600">{formatActivity(company.lastSeenAt)}</p>
                  </td>
                  <td className="px-5 py-4">
                    <p className="text-sm font-medium text-white">{formatBrl(company.currentMonthRevenueCents)}</p>
                    <p className="mt-1 text-[11px] text-slate-600">
                      {company.currentMonthPaidOrdersCount.toLocaleString("pt-BR")} {company.currentMonthPaidOrdersCount === 1 ? "pedido pago" : "pedidos pagos"}
                    </p>
                  </td>
                  <td className="px-5 py-4">
                    <p className="text-sm font-medium text-white">{formatBrl(company.currentMonthCommissionCents)}</p>
                    <p className="mt-1 text-[11px] text-slate-600">Taxa efetiva {formatCommission(company.effectiveCommissionBps)}</p>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      {company.adminPanelUrl ? (
                        <a
                          href={company.adminPanelUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-700 px-3 text-xs font-medium text-slate-200 transition hover:border-violet-400/60 hover:text-white"
                        >
                          Abrir painel
                          <ExternalLink aria-hidden="true" className="size-3.5" />
                        </a>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setEditing(company)}
                        disabled={!company.companyId}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-700 px-3 text-xs font-medium text-slate-400 transition hover:border-violet-400/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={company.adminPanelUrl ? `Editar link de ${company.companyName}` : `Configurar link de ${company.companyName}`}
                      >
                        {company.adminPanelUrl ? <Pencil aria-hidden="true" className="size-3.5" /> : <Link2 aria-hidden="true" className="size-3.5" />}
                        {company.adminPanelUrl ? "Editar" : "Definir link"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 ? (
        <div className="border-t border-slate-800 px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-300">Nenhuma empresa encontrada</p>
          <p className="mt-1 text-xs text-slate-600">Revise a busca ou o filtro selecionado.</p>
        </div>
      ) : null}

      {editing ? <AdminUrlEditor key={editing.companyId ?? editing.guildId} company={editing} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}
