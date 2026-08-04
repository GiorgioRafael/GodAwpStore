import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BusinessBotsTable } from "./business-bots-table";
import type { DiscordBotService } from "@/lib/data/discord-bots-dashboard";

const services: DiscordBotService[] = [
  {
    id: "gwstore",
    name: "GWStore",
    adminPanelUrl: "https://gwstore.vercel.app",
    available: true,
    error: null,
    health: { label: "Ativo", tone: "neutral" },
    bots: [
      {
        guildId: "fcc48793-8726-4b9f-98b0-5f8c73af905d",
        discordGuildId: "1401264061101899820",
        guildName: "GW STORE",
        ownerDiscordId: "385924725332901909",
        status: "active",
        lastSeenAt: null,
        lastPaidAt: "2026-08-04T12:00:00.000Z",
        currentMonthRevenueCents: 34_180,
        previousMonthRevenueCents: 118_435,
        currentMonthPaidOrdersCount: 60,
        health: { label: "Ativo", tone: "neutral" },
      },
    ],
    effectiveCommissionBps: 200,
    currentMonthRevenueCents: 34_180,
    previousMonthRevenueCents: 118_435,
    currentMonthCommissionCents: 684,
    currentMonthPaidOrdersCount: 60,
    lastPaidAt: "2026-08-04T12:00:00.000Z",
  },
  {
    id: "thstore",
    name: "Loja TH",
    adminPanelUrl: "https://thstoreadm.vercel.app",
    available: true,
    error: null,
    health: { label: "Online", tone: "success" },
    bots: [],
    effectiveCommissionBps: 200,
    currentMonthRevenueCents: 10_000,
    previousMonthRevenueCents: 8_000,
    currentMonthCommissionCents: 200,
    currentMonthPaidOrdersCount: 4,
    lastPaidAt: null,
  },
];

describe("tabela multi-serviço", () => {
  it("mostra GWStore e Loja TH com seus painéis e faturamentos separados", () => {
    render(<BusinessBotsTable services={services} />);

    const gwRow = screen.getByRole("row", { name: /GWStore/ });
    const thRow = screen.getByRole("row", { name: /Loja TH/ });
    expect(within(gwRow).getByText("R$ 341,80")).toBeInTheDocument();
    expect(within(gwRow).getByText("R$ 6,84")).toBeInTheDocument();
    expect(within(gwRow).getByRole("link", { name: "Abrir painel" })).toHaveAttribute(
      "href",
      "https://gwstore.vercel.app",
    );
    expect(within(thRow).getByText("R$ 100,00")).toBeInTheDocument();
    expect(within(thRow).getByRole("link", { name: "Abrir painel" })).toHaveAttribute(
      "href",
      "https://thstoreadm.vercel.app",
    );
  });
});

