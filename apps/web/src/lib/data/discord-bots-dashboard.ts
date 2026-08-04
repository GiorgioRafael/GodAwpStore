import "server-only";

import { requireMasterAdmin } from "@/lib/master-auth-session";
import {
  calculateRevenueChange,
  calculateCommissionFromGross,
  formatDashboardMonth,
  getBotHealth,
  type BotHealth,
} from "@/lib/discord-bots-dashboard";
import {
  serviceDashboardSnapshotSchema,
  type ServiceDashboardSnapshot,
} from "@/lib/master-dashboard-contract";
import { getLocalServiceDashboardSnapshot } from "@/lib/data/service-dashboard-snapshot";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type DiscordBotsMonthlyRevenue = {
  monthStart: string;
  monthLabel: string;
  grossRevenueCents: number;
  commissionCents: number;
  paidOrdersCount: number;
};

export type DiscordBotServiceBot = ServiceDashboardSnapshot["bots"][number] & {
  health: BotHealth;
};

export type DiscordBotService = {
  id: string;
  name: string;
  adminPanelUrl: string;
  available: boolean;
  error: string | null;
  health: BotHealth;
  bots: DiscordBotServiceBot[];
  effectiveCommissionBps: number;
  currentMonthRevenueCents: number;
  previousMonthRevenueCents: number;
  currentMonthCommissionCents: number;
  previousMonthCommissionCents: number;
  currentMonthPaidOrdersCount: number;
  lastPaidAt: string | null;
};

export type DiscordBotsDashboard = {
  globalCommissionBps: number;
  currentMonthRevenueCents: number;
  previousMonthRevenueCents: number;
  currentMonthCommissionCents: number;
  currentMonthPaidOrdersCount: number;
  revenueChangePercent: number | null;
  activeBotsCount: number;
  onlineBotsCount: number;
  servicesCount: number;
  monthlyRevenue: DiscordBotsMonthlyRevenue[];
  services: DiscordBotService[];
};

type ServiceSource = {
  id: string;
  name: string;
  adminPanelUrl: string;
  snapshot: ServiceDashboardSnapshot | null;
  error: string | null;
};

const REMOTE_SERVICES = [
  {
    id: "thstore",
    name: "Loja TH",
    adminPanelUrl: process.env.THSTORE_ADMIN_URL?.trim() || "https://thstoreadm.vercel.app",
  },
] as const;

const GWSTORE_ADMIN_URL =
  process.env.GWSTORE_ADMIN_URL?.trim() || "https://gwstore.vercel.app";

function safeInteger(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function latestIso(values: Array<string | null>): string | null {
  const present = values.filter((value): value is string => Boolean(value));
  return present.length > 0 ? present.reduce((latest, value) => (value > latest ? value : latest)) : null;
}

function serviceHealth(bots: DiscordBotServiceBot[], available: boolean): BotHealth {
  if (!available) return { label: "Indisponível", tone: "danger" };
  if (bots.some((bot) => bot.health.label === "Online")) return { label: "Online", tone: "success" };
  if (bots.some((bot) => bot.status === "active")) return { label: "Ativo", tone: "neutral" };
  if (bots.some((bot) => bot.status === "suspended")) return { label: "Suspenso", tone: "warning" };
  return { label: "Desconectado", tone: "danger" };
}

async function readRemoteService(source: (typeof REMOTE_SERVICES)[number]): Promise<ServiceSource> {
  const secret = process.env.MASTER_DASHBOARD_SHARED_SECRET?.trim();
  if (!secret) {
    return { ...source, snapshot: null, error: "Integração segura ainda não configurada." };
  }

  try {
    const response = await fetch(new URL("/api/internal/master-dashboard", source.adminPanelUrl), {
      cache: "no-store",
      headers: { "x-101devs-master-secret": secret },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = serviceDashboardSnapshotSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("Resposta inválida");
    return { ...source, snapshot: parsed.data, error: null };
  } catch {
    return { ...source, snapshot: null, error: "Não foi possível atualizar os dados deste serviço." };
  }
}

function sourceToService(source: ServiceSource, commissionBps: number): DiscordBotService {
  const snapshot = source.snapshot;
  const bots: DiscordBotServiceBot[] = (snapshot?.bots ?? []).map((bot) => ({
    ...bot,
    health: getBotHealth(bot.status, bot.lastSeenAt),
  }));
  const currentMonth = snapshot?.monthlyRevenue.at(-1);
  const previousMonth = snapshot?.monthlyRevenue.at(-2);
  const currentMonthRevenueCents = safeInteger(currentMonth?.grossRevenueCents);
  const previousMonthRevenueCents = safeInteger(previousMonth?.grossRevenueCents);

  return {
    id: source.id,
    name: source.name,
    adminPanelUrl: source.adminPanelUrl,
    available: Boolean(snapshot),
    error: source.error,
    health: serviceHealth(bots, Boolean(snapshot)),
    bots,
    effectiveCommissionBps: commissionBps,
    currentMonthRevenueCents,
    previousMonthRevenueCents,
    currentMonthCommissionCents: calculateCommissionFromGross(currentMonthRevenueCents, commissionBps),
    previousMonthCommissionCents: calculateCommissionFromGross(previousMonthRevenueCents, commissionBps),
    currentMonthPaidOrdersCount: safeInteger(currentMonth?.paidOrdersCount),
    lastPaidAt: latestIso(bots.map((bot) => bot.lastPaidAt)),
  };
}

function aggregateMonthlyRevenue(sources: ServiceSource[], commissionBps: number): DiscordBotsMonthlyRevenue[] {
  const months = new Map<string, { grossRevenueCents: number; paidOrdersCount: number }>();
  for (const source of sources) {
    for (const month of source.snapshot?.monthlyRevenue ?? []) {
      const aggregate = months.get(month.monthStart) ?? { grossRevenueCents: 0, paidOrdersCount: 0 };
      aggregate.grossRevenueCents += safeInteger(month.grossRevenueCents);
      aggregate.paidOrdersCount += safeInteger(month.paidOrdersCount);
      months.set(month.monthStart, aggregate);
    }
  }

  return [...months.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([monthStart, month]) => ({
      monthStart,
      monthLabel: formatDashboardMonth(monthStart),
      grossRevenueCents: month.grossRevenueCents,
      commissionCents: calculateCommissionFromGross(month.grossRevenueCents, commissionBps),
      paidOrdersCount: month.paidOrdersCount,
    }));
}

export async function getDiscordBotsDashboard(): Promise<DiscordBotsDashboard> {
  await requireMasterAdmin();
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new Error("Supabase não configurado.");

  const [settingsResult, localSnapshot, ...remoteSources] = await Promise.all([
    supabase.from("platform_settings").select("global_commission_bps").eq("id", 1).single(),
    getLocalServiceDashboardSnapshot(),
    ...REMOTE_SERVICES.map(readRemoteService),
  ]);
  if (settingsResult.error) throw new Error("Não foi possível carregar a configuração de comissão.");

  const globalCommissionBps = safeInteger(settingsResult.data?.global_commission_bps ?? 200);
  const sources: ServiceSource[] = [
    {
      id: "gwstore",
      name: "GWStore",
      adminPanelUrl: GWSTORE_ADMIN_URL,
      snapshot: localSnapshot,
      error: null,
    },
    ...remoteSources,
  ];
  const services = sources.map((source) => sourceToService(source, globalCommissionBps));
  const monthlyRevenue = aggregateMonthlyRevenue(sources, globalCommissionBps);
  const currentMonth = monthlyRevenue.at(-1);
  const previousMonth = monthlyRevenue.at(-2);
  const currentMonthRevenueCents = currentMonth?.grossRevenueCents ?? 0;
  const previousMonthRevenueCents = previousMonth?.grossRevenueCents ?? 0;
  const bots = services.flatMap((service) => service.bots);

  return {
    globalCommissionBps,
    currentMonthRevenueCents,
    previousMonthRevenueCents,
    currentMonthCommissionCents: calculateCommissionFromGross(currentMonthRevenueCents, globalCommissionBps),
    currentMonthPaidOrdersCount: currentMonth?.paidOrdersCount ?? 0,
    revenueChangePercent: calculateRevenueChange(currentMonthRevenueCents, previousMonthRevenueCents),
    activeBotsCount: bots.filter((bot) => bot.status === "active").length,
    onlineBotsCount: bots.filter((bot) => bot.health.label === "Online").length,
    servicesCount: services.length,
    monthlyRevenue,
    services,
  };
}
