import "server-only";

import { requireAdmin } from "@/lib/auth";
import {
  calculateRevenueChange,
  formatDashboardMonth,
  getBotHealth,
  type BotHealth,
} from "@/lib/discord-bots-dashboard";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type DiscordBotsMonthlyRevenue = {
  monthStart: string;
  monthLabel: string;
  grossRevenueCents: number;
  commissionCents: number;
  paidOrdersCount: number;
};

export type DiscordBotCompany = {
  guildId: string;
  discordGuildId: string;
  guildName: string;
  ownerDiscordId: string;
  companyId: string | null;
  companyName: string;
  adminPanelUrl: string | null;
  status: "active" | "suspended" | "left" | "archived";
  health: BotHealth;
  joinedAt: string | null;
  lastSeenAt: string | null;
  lastPaidAt: string | null;
  effectiveCommissionBps: number;
  currentMonthRevenueCents: number;
  previousMonthRevenueCents: number;
  currentMonthCommissionCents: number;
  currentMonthPaidOrdersCount: number;
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
  companiesCount: number;
  monthlyRevenue: DiscordBotsMonthlyRevenue[];
  companies: DiscordBotCompany[];
};

function safeInteger(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function queryFailure(operation: string, error: { message: string } | null) {
  if (error) throw new Error(`Não foi possível ${operation}.`);
}

export async function getDiscordBotsDashboard(): Promise<DiscordBotsDashboard> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new Error("Supabase não configurado.");

  const [settingsResult, monthlyResult, companiesResult] = await Promise.all([
    supabase
      .from("platform_settings")
      .select("global_commission_bps")
      .eq("id", 1)
      .single(),
    supabase
      .from("discord_bots_admin_monthly_revenue")
      .select("month_start,gross_revenue_cents,commission_cents,paid_orders_count")
      .order("month_start", { ascending: true }),
    supabase
      .from("discord_bots_admin_companies")
      .select("*")
      .order("current_month_revenue_cents", { ascending: false })
      .order("company_name", { ascending: true }),
  ]);

  queryFailure("carregar a configuração de comissão", settingsResult.error);
  queryFailure("carregar o faturamento mensal", monthlyResult.error);
  queryFailure("carregar as empresas e bots", companiesResult.error);

  const monthlyRevenue: DiscordBotsMonthlyRevenue[] = (monthlyResult.data ?? []).map(
    (month) => ({
      monthStart: month.month_start,
      monthLabel: formatDashboardMonth(month.month_start),
      grossRevenueCents: safeInteger(month.gross_revenue_cents),
      commissionCents: safeInteger(month.commission_cents),
      paidOrdersCount: safeInteger(month.paid_orders_count),
    }),
  );

  const companies: DiscordBotCompany[] = (companiesResult.data ?? []).map((company) => {
    const status = company.guild_status;
    return {
      guildId: company.guild_id,
      discordGuildId: company.discord_guild_id,
      guildName: company.guild_name,
      ownerDiscordId: company.owner_discord_id,
      companyId: company.whitelist_entry_id,
      companyName: company.company_name,
      adminPanelUrl: company.admin_panel_url,
      status,
      health: getBotHealth(status, company.last_bot_seen_at),
      joinedAt: company.joined_at,
      lastSeenAt: company.last_bot_seen_at,
      lastPaidAt: company.last_paid_at,
      effectiveCommissionBps: safeInteger(company.effective_commission_bps),
      currentMonthRevenueCents: safeInteger(company.current_month_revenue_cents),
      previousMonthRevenueCents: safeInteger(company.previous_month_revenue_cents),
      currentMonthCommissionCents: safeInteger(company.current_month_commission_cents),
      currentMonthPaidOrdersCount: safeInteger(company.current_month_paid_orders_count),
    };
  });

  const currentMonth = monthlyRevenue.at(-1);
  const previousMonth = monthlyRevenue.at(-2);
  const currentMonthRevenueCents = currentMonth?.grossRevenueCents ?? 0;
  const previousMonthRevenueCents = previousMonth?.grossRevenueCents ?? 0;
  const companyKeys = new Set(
    companies.map((company) => company.companyId ?? `owner:${company.ownerDiscordId}`),
  );

  return {
    globalCommissionBps: safeInteger(settingsResult.data?.global_commission_bps ?? 200),
    currentMonthRevenueCents,
    previousMonthRevenueCents,
    currentMonthCommissionCents: currentMonth?.commissionCents ?? 0,
    currentMonthPaidOrdersCount: currentMonth?.paidOrdersCount ?? 0,
    revenueChangePercent: calculateRevenueChange(
      currentMonthRevenueCents,
      previousMonthRevenueCents,
    ),
    activeBotsCount: companies.filter((company) => company.status === "active").length,
    onlineBotsCount: companies.filter((company) => company.health.label === "Online").length,
    companiesCount: companyKeys.size,
    monthlyRevenue,
    companies,
  };
}
