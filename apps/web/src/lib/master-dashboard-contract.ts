import { z } from "zod";

const moneyCentsSchema = z.number().int().nonnegative();

export const serviceDashboardSnapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().datetime(),
  service: z.object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(120),
    adminPanelUrl: z.string().url(),
  }),
  monthlyRevenue: z.array(
    z.object({
      monthStart: z.string().regex(/^\d{4}-\d{2}-01$/),
      grossRevenueCents: moneyCentsSchema,
      paidOrdersCount: z.number().int().nonnegative(),
    }),
  ),
  bots: z.array(
    z.object({
      guildId: z.string().uuid(),
      discordGuildId: z.string().min(1),
      guildName: z.string().min(1),
      ownerDiscordId: z.string().min(1),
      status: z.enum(["active", "suspended", "left", "archived"]),
      lastSeenAt: z.string().datetime().nullable(),
      lastPaidAt: z.string().datetime().nullable(),
      currentMonthRevenueCents: moneyCentsSchema,
      previousMonthRevenueCents: moneyCentsSchema,
      currentMonthPaidOrdersCount: z.number().int().nonnegative(),
    }),
  ),
});

export type ServiceDashboardSnapshot = z.infer<typeof serviceDashboardSnapshotSchema>;

