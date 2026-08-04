"use client";

import { useMemo, useState } from "react";
import { formatBrl } from "@godawp/domain";
import { ExternalLink, Search, SlidersHorizontal } from "lucide-react";

import { formatCommission } from "@/components/admin/admin-format";
import type { DiscordBotService } from "@/lib/data/discord-bots-dashboard";

type StatusFilter = "all" | "online" | "attention";

function formatActivity(value: string | null) {
  if (!value) return "Nenhuma venda registrada";
  return `Última venda ${new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value))}`;
}

function healthClasses(tone: DiscordBotService["health"]["tone"]) {
  if (tone === "success") return "bg-emerald-400 text-emerald-400";
  if (tone === "warning") return "bg-amber-400 text-amber-300";
  if (tone === "danger") return "bg-rose-400 text-rose-300";
  return "bg-slate-500 text-slate-300";
}

function botSummary(service: DiscordBotService) {
  const first = service.bots[0];
  if (!first) return { name: "Nenhum bot conectado", detail: "—" };
  const extra = service.bots.length - 1;
  return {
    name: extra > 0 ? `${first.guildName} +${extra}` : first.guildName,
    detail: first.discordGuildId,
  };
}

export function BusinessBotsTable({ services }: { services: DiscordBotService[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return services.filter((service) => {
      const searchable = [
        service.name,
        ...service.bots.flatMap((bot) => [bot.guildName, bot.discordGuildId]),
      ].join(" ").toLocaleLowerCase("pt-BR");
      const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
      const matchesStatus =
        status === "all" ||
        (status === "online" && service.health.label === "Online") ||
        (status === "attention" && (!service.available || service.health.tone === "warning" || service.health.tone === "danger"));
      return matchesQuery && matchesStatus;
    });
  }, [query, services, status]);

  return (
    <section id="empresas" aria-labelledby="servicos-bots-titulo" className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0b121c] shadow-[0_22px_70px_rgba(0,0,0,.2)]">
      <div className="flex flex-col gap-4 border-b border-slate-800 p-5 sm:p-6 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h2 id="servicos-bots-titulo" className="text-base font-semibold tracking-tight text-white sm:text-lg">
            Serviços da 101Devs
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {services.length.toLocaleString("pt-BR")} {services.length === 1 ? "serviço monitorado" : "serviços monitorados"}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative block sm:w-80">
            <span className="sr-only">Buscar serviço ou bot</span>
            <Search aria-hidden="true" className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar serviço ou bot"
              className="h-10 w-full rounded-lg border border-slate-700 bg-[#080f18] pl-10 pr-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-violet-400"
            />
          </label>
          <label className="relative block">
            <span className="sr-only">Filtrar status dos serviços</span>
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
        <table className="w-full min-w-[1360px] border-collapse text-left">
          <thead className="bg-white/[0.018] text-xs font-medium text-slate-400">
            <tr>
              <th className="px-6 py-3.5">Serviço</th>
              <th className="px-5 py-3.5">Bot / servidor</th>
              <th className="px-5 py-3.5">Status</th>
              <th className="px-5 py-3.5">Mês atual</th>
              <th className="px-5 py-3.5">Mês anterior</th>
              <th className="px-5 py-3.5">Comissão mês atual</th>
              <th className="px-5 py-3.5">Comissão mês anterior</th>
              <th className="px-6 py-3.5 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((service) => {
              const statusClasses = healthClasses(service.health.tone);
              const bot = botSummary(service);
              return (
                <tr key={service.id} className="border-t border-slate-800/90 transition-colors hover:bg-white/[0.018]">
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-white">{service.name}</p>
                    <p className="mt-1 text-[11px] text-slate-600">
                      {service.bots.length.toLocaleString("pt-BR")} {service.bots.length === 1 ? "bot" : "bots"}
                    </p>
                  </td>
                  <td className="px-5 py-4">
                    <p className="text-sm font-medium text-slate-200">{bot.name}</p>
                    <p className="mt-1 font-mono text-[11px] text-slate-600">{bot.detail}</p>
                  </td>
                  <td className="px-5 py-4">
                    <div className={`inline-flex items-center gap-2 text-sm font-medium ${statusClasses.split(" ").at(-1)}`}>
                      <span className={`size-2 rounded-full ${statusClasses.split(" ")[0]}`} />
                      {service.health.label}
                    </div>
                    <p className="mt-1 max-w-56 text-[11px] text-slate-600">
                      {service.error ?? formatActivity(service.lastPaidAt)}
                    </p>
                  </td>
                  <td className="px-5 py-4">
                    <p className="text-sm font-medium text-white">
                      {service.available ? formatBrl(service.currentMonthRevenueCents) : "—"}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-600">
                      {service.available ? `${service.currentMonthPaidOrdersCount.toLocaleString("pt-BR")} pedidos pagos` : "Sem atualização"}
                    </p>
                  </td>
                  <td className="px-5 py-4">
                    <p className="text-sm font-medium text-white">
                      {service.available ? formatBrl(service.previousMonthRevenueCents) : "—"}
                    </p>
                  </td>
                  <td className="px-5 py-4">
                    <p className="text-sm font-medium text-white">
                      {service.available ? formatBrl(service.currentMonthCommissionCents) : "—"}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-600">Taxa {formatCommission(service.effectiveCommissionBps)}</p>
                  </td>
                  <td className="px-5 py-4">
                    <p className="text-sm font-medium text-white">
                      {service.available ? formatBrl(service.previousMonthCommissionCents) : "—"}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-600">Taxa {formatCommission(service.effectiveCommissionBps)}</p>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <a
                      href={service.adminPanelUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-700 px-3 text-xs font-medium text-slate-200 transition hover:border-violet-400/60 hover:text-white"
                    >
                      Abrir painel
                      <ExternalLink aria-hidden="true" className="size-3.5" />
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 ? (
        <div className="border-t border-slate-800 px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-300">Nenhum serviço encontrado</p>
          <p className="mt-1 text-xs text-slate-600">Revise a busca ou o filtro selecionado.</p>
        </div>
      ) : null}
    </section>
  );
}
