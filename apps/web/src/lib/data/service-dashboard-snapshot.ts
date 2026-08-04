import "server-only";

import { getSiteUrl } from "@/lib/env";
import type { ServiceDashboardSnapshot } from "@/lib/master-dashboard-contract";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const TIME_ZONE = "America/Sao_Paulo";
const MONTHS_TO_REPORT = 6;
const QUERY_PAGE_SIZE = 1_000;

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;
type GuildStatus = ServiceDashboardSnapshot["bots"][number]["status"];

type GuildRow = {
  id: string;
  discord_guild_id: string;
  name: string;
  owner_discord_id: string;
  status: GuildStatus;
  last_bot_seen_at?: string | null;
};

type PaidOrderRow = {
  guild_id: string;
  sale_price_cents: number;
  paid_at: string;
};

function safeInteger(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function serviceId(name: string) {
  const configured = process.env.MASTER_SERVICE_ID?.trim();
  if (configured) return configured;
  return (
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "service"
  );
}

function monthKey(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: TIME_ZONE,
  }).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  return `${year}-${month}-01`;
}

function recentMonthKeys(now = new Date()): string[] {
  const current = monthKey(now);
  const [year, month] = current.split("-").map(Number);
  return Array.from({ length: MONTHS_TO_REPORT }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - (MONTHS_TO_REPORT - 1 - index), 15));
    return monthKey(date);
  });
}

async function readGuilds(client: AdminClient): Promise<GuildRow[]> {
  const detailed = await client
    .from("guilds")
    .select("id,discord_guild_id,name,owner_discord_id,status,last_bot_seen_at")
    .is("archived_at", null)
    .order("name", { ascending: true });

  if (!detailed.error) return (detailed.data ?? []) as GuildRow[];

  // TH Store predates the bot heartbeat column. Keep the service visible while
  // its database catches up with the newest shared schema.
  const compatible = await client
    .from("guilds")
    .select("id,discord_guild_id,name,owner_discord_id,status")
    .is("archived_at", null)
    .order("name", { ascending: true });
  if (compatible.error) throw new Error("Não foi possível carregar os bots deste serviço.");
  return (compatible.data ?? []) as GuildRow[];
}

async function readPaidOrders(client: AdminClient, since: string): Promise<PaidOrderRow[]> {
  const rows: PaidOrderRow[] = [];

  for (let offset = 0; ; offset += QUERY_PAGE_SIZE) {
    const result = await client
      .from("orders")
      .select("guild_id,sale_price_cents,paid_at")
      .eq("payment_provider", "livepix")
      .eq("payment_status", "paid")
      .not("paid_at", "is", null)
      .is("stock_released_at", null)
      .gte("paid_at", since)
      .order("paid_at", { ascending: true })
      .range(offset, offset + QUERY_PAGE_SIZE - 1);

    if (result.error) throw new Error("Não foi possível carregar o faturamento deste serviço.");
    const page = (result.data ?? []) as PaidOrderRow[];
    rows.push(...page);
    if (page.length < QUERY_PAGE_SIZE) return rows;
  }
}

function latestIso(values: string[]): string | null {
  return values.length > 0 ? values.reduce((latest, value) => (value > latest ? value : latest)) : null;
}

export async function getLocalServiceDashboardSnapshot(): Promise<ServiceDashboardSnapshot> {
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");

  const keys = recentMonthKeys();
  const since = `${keys[0]}T00:00:00-03:00`;
  const [guilds, orders] = await Promise.all([readGuilds(client), readPaidOrders(client, since)]);
  const monthly = new Map(keys.map((key) => [key, { grossRevenueCents: 0, paidOrdersCount: 0 }]));
  const ordersByGuild = new Map<string, PaidOrderRow[]>();

  for (const order of orders) {
    const key = monthKey(new Date(order.paid_at));
    const entry = monthly.get(key);
    if (!entry) continue;
    entry.grossRevenueCents += safeInteger(order.sale_price_cents);
    entry.paidOrdersCount += 1;
    const guildOrders = ordersByGuild.get(order.guild_id) ?? [];
    guildOrders.push(order);
    ordersByGuild.set(order.guild_id, guildOrders);
  }

  const currentMonth = keys.at(-1) ?? "";
  const previousMonth = keys.at(-2) ?? "";
  const name = process.env.NEXT_PUBLIC_STORE_NAME?.trim() || "Serviço Discord";

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    service: {
      id: serviceId(name),
      name,
      adminPanelUrl: getSiteUrl(),
    },
    monthlyRevenue: keys.map((key) => ({ monthStart: key, ...(monthly.get(key) ?? { grossRevenueCents: 0, paidOrdersCount: 0 }) })),
    bots: guilds.map((guild) => {
      const guildOrders = ordersByGuild.get(guild.id) ?? [];
      const currentOrders = guildOrders.filter((order) => monthKey(new Date(order.paid_at)) === currentMonth);
      const previousOrders = guildOrders.filter((order) => monthKey(new Date(order.paid_at)) === previousMonth);
      return {
        guildId: guild.id,
        discordGuildId: guild.discord_guild_id,
        guildName: guild.name,
        ownerDiscordId: guild.owner_discord_id,
        status: guild.status,
        lastSeenAt: guild.last_bot_seen_at ?? null,
        lastPaidAt: latestIso(guildOrders.map((order) => order.paid_at)),
        currentMonthRevenueCents: currentOrders.reduce((sum, order) => sum + safeInteger(order.sale_price_cents), 0),
        previousMonthRevenueCents: previousOrders.reduce((sum, order) => sum + safeInteger(order.sale_price_cents), 0),
        currentMonthPaidOrdersCount: currentOrders.length,
      };
    }),
  };
}
