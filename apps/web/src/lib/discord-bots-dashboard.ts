export type BotHealth = {
  label: "Online" | "Ativo" | "Suspenso" | "Desconectado" | "Arquivado" | "Indisponível";
  tone: "success" | "neutral" | "warning" | "danger";
};

const ONLINE_WINDOW_MS = 15 * 60 * 1_000;

export function getBotHealth(
  status: "active" | "suspended" | "left" | "archived",
  lastSeenAt: string | null,
  now = Date.now(),
): BotHealth {
  if (status === "suspended") return { label: "Suspenso", tone: "warning" };
  if (status === "left") return { label: "Desconectado", tone: "danger" };
  if (status === "archived") return { label: "Arquivado", tone: "neutral" };

  const lastSeen = lastSeenAt ? Date.parse(lastSeenAt) : Number.NaN;
  if (Number.isFinite(lastSeen) && now - lastSeen <= ONLINE_WINDOW_MS) {
    return { label: "Online", tone: "success" };
  }

  return { label: "Ativo", tone: "neutral" };
}

export function formatDashboardMonth(monthStart: string): string {
  const parsed = new Date(`${monthStart}T12:00:00-03:00`);
  if (Number.isNaN(parsed.getTime())) return monthStart;

  const label = new Intl.DateTimeFormat("pt-BR", {
    month: "short",
    timeZone: "America/Sao_Paulo",
  })
    .format(parsed)
    .replace(".", "");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function calculateRevenueChange(
  currentRevenueCents: number,
  previousRevenueCents: number,
): number | null {
  if (previousRevenueCents <= 0) return null;
  return ((currentRevenueCents - previousRevenueCents) / previousRevenueCents) * 100;
}

export function calculateCommissionFromGross(
  grossRevenueCents: number,
  commissionBps: number,
): number {
  if (!Number.isSafeInteger(grossRevenueCents) || grossRevenueCents <= 0) return 0;
  if (!Number.isSafeInteger(commissionBps) || commissionBps <= 0) return 0;
  return Math.round((grossRevenueCents * commissionBps) / 10_000);
}
