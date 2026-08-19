import type { LucideIcon } from "lucide-react";

/** Cartão de indicador do painel mestre, compartilhado por todas as abas. */
export function MasterMetricCard({
  label,
  value,
  detail,
  icon: Icon,
  accent = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  accent?: "neutral" | "violet" | "success";
}) {
  const iconClass =
    accent === "violet"
      ? "border-violet-400/15 bg-violet-500/[0.08] text-violet-300"
      : accent === "success"
        ? "border-emerald-400/15 bg-emerald-400/[0.07] text-emerald-300"
        : "border-slate-700 bg-slate-800/50 text-slate-400";

  return (
    <article className="min-h-36 rounded-2xl border border-slate-800 bg-[#0b121c] p-5 shadow-[0_18px_55px_rgba(0,0,0,.16)]">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-medium text-slate-300">{label}</p>
        <span className={`grid size-9 shrink-0 place-items-center rounded-lg border ${iconClass}`}>
          <Icon aria-hidden="true" className="size-[17px]" strokeWidth={1.8} />
        </span>
      </div>
      <p className="mt-4 text-2xl font-semibold tracking-[-0.035em] text-white sm:text-[28px]">{value}</p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>
    </article>
  );
}

/** Cabeçalho padrão de uma aba: título, explicação e o mês de referência. */
export function MasterPageHeader({
  title,
  description,
  aside,
}: {
  title: string;
  description: string;
  aside?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-5 pb-1 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.035em] text-white sm:text-[32px]">{title}</h1>
        <p className="mt-2 text-sm text-slate-400 sm:text-base">{description}</p>
      </div>
      {aside ? <div className="flex flex-wrap items-center gap-2">{aside}</div> : null}
    </header>
  );
}

export function currentPeriodLabel(now = new Date()) {
  const label = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(now);
  return label.charAt(0).toUpperCase() + label.slice(1);
}
