import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class DiscordTicketChannelMissingError extends Error {
    constructor(
      readonly orderId: string,
      readonly channelId: string,
    ) {
      super("Canal inicial ausente");
      this.name = "DiscordTicketChannelMissingError";
    }
  }

  return {
    createAdminSupabaseClient: vi.fn(),
    loadBotRuntimeSettingsStrict: vi.fn(),
    synchronizeOpenDiscordTicketControls: vi.fn(),
    DiscordTicketChannelMissingError,
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}));
vi.mock("./message-customization-server", () => ({
  loadBotRuntimeSettingsStrict: mocks.loadBotRuntimeSettingsStrict,
}));
vi.mock("./discord-ticket-controls", () => ({
  synchronizeOpenDiscordTicketControls: mocks.synchronizeOpenDiscordTicketControls,
  DiscordTicketChannelMissingError: mocks.DiscordTicketChannelMissingError,
}));

import { DEFAULT_BOT_MESSAGE_CUSTOMIZATION } from "./message-customization";
import { synchronizeAllOpenDiscordTicketControls } from "./discord-ticket-controls-sync";

const settings = {
  customization: DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
  ticketNotificationDiscordUserIds: ["385924725332901909"],
  ticketCloseAdminDiscordUserIds: ["234486394414825472"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadBotRuntimeSettingsStrict.mockResolvedValue(settings);
  mocks.synchronizeOpenDiscordTicketControls.mockResolvedValue({
    permissionsUpdated: true,
    welcomeMessageUpdated: true,
  });
});

describe("sincronização retroativa dos controles de ticket", () => {
  it("repara tickets abertos com a configuração atual", async () => {
    const client = clientMock({
      orders: [
        {
          id: "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
          guild_id: "8a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
          buyer_discord_id: "223456789012345678",
          discord_ticket_channel_id: "423456789012345678",
        },
      ],
      guilds: [
        {
          id: "8a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
          discord_guild_id: "123456789012345678",
        },
      ],
    });

    await expect(
      synchronizeAllOpenDiscordTicketControls({ client: client as never }),
    ).resolves.toEqual({
      processed: 1,
      synchronized: 1,
      missingChannelsClosed: 0,
      failed: 0,
      permissionsUpdated: 1,
      welcomeMessagesUpdated: 1,
    });
    expect(mocks.synchronizeOpenDiscordTicketControls).toHaveBeenCalledWith(
      {
        orderId: "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
        guildId: "123456789012345678",
        buyerDiscordId: "223456789012345678",
        channelId: "423456789012345678",
        settings,
      },
      { fetcher: undefined },
    );
  });

  it("isola falhas por ticket e contabiliza vínculos de servidor ausentes", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = clientMock({
      orders: [
        {
          id: "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
          guild_id: "8a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
          buyer_discord_id: "223456789012345678",
          discord_ticket_channel_id: "423456789012345678",
        },
        {
          id: "7a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
          guild_id: "6a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
          buyer_discord_id: "323456789012345678",
          discord_ticket_channel_id: "523456789012345678",
        },
      ],
      guilds: [
        {
          id: "8a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
          discord_guild_id: "123456789012345678",
        },
      ],
    });
    mocks.synchronizeOpenDiscordTicketControls.mockRejectedValueOnce(
      new Error("Discord indisponível"),
    );

    await expect(
      synchronizeAllOpenDiscordTicketControls({ client: client as never, concurrency: 1 }),
    ).resolves.toMatchObject({
      processed: 2,
      synchronized: 0,
      missingChannelsClosed: 0,
      failed: 2,
    });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("Discord indisponível"),
    );
  });

  it("fecha no banco somente ticket cujo canal inicial retornou 404", async () => {
    const order = openTicket(1, "8a845b40-7c4e-4d25-9f3f-3cbd27f050c9");
    const client = clientMock({
      orders: [order],
      guilds: [
        {
          id: order.guild_id,
          discord_guild_id: "123456789012345678",
        },
      ],
      rpcResult: {
        data: {
          reconciled_order_id: order.id,
          was_closed: true,
          ticket_status: "closed",
          ticket_channel_id: order.discord_ticket_channel_id,
          closed_at: "2026-07-19T12:00:00.000Z",
          closed_by_discord_user_id: null,
        },
        error: null,
      },
    });
    mocks.synchronizeOpenDiscordTicketControls.mockRejectedValueOnce(
      new mocks.DiscordTicketChannelMissingError(
        order.id,
        order.discord_ticket_channel_id,
      ),
    );

    await expect(
      synchronizeAllOpenDiscordTicketControls({ client: client as never }),
    ).resolves.toEqual({
      processed: 1,
      synchronized: 0,
      missingChannelsClosed: 1,
      failed: 0,
      permissionsUpdated: 0,
      welcomeMessagesUpdated: 0,
    });
    expect(client.rpc).toHaveBeenCalledWith("reconcile_missing_discord_ticket", {
      p_order_id: order.id,
      p_ticket_channel_id: order.discord_ticket_channel_id,
    });
    expect(client.rpcSingle).toHaveBeenCalledOnce();
  });

  it("trata reconciliação concorrente como sucesso idempotente", async () => {
    const order = openTicket(2, "8a845b40-7c4e-4d25-9f3f-3cbd27f050c9");
    const client = clientMock({
      orders: [order],
      guilds: [
        {
          id: order.guild_id,
          discord_guild_id: "123456789012345678",
        },
      ],
      rpcResult: {
        data: {
          reconciled_order_id: order.id,
          was_closed: false,
          ticket_status: "closed",
          ticket_channel_id: order.discord_ticket_channel_id,
          closed_at: "2026-07-19T12:00:00.000Z",
          closed_by_discord_user_id: null,
        },
        error: null,
      },
    });
    mocks.synchronizeOpenDiscordTicketControls.mockRejectedValueOnce(
      new mocks.DiscordTicketChannelMissingError(
        order.id,
        order.discord_ticket_channel_id,
      ),
    );

    await expect(
      synchronizeAllOpenDiscordTicketControls({ client: client as never }),
    ).resolves.toMatchObject({
      processed: 1,
      synchronized: 0,
      missingChannelsClosed: 0,
      failed: 0,
    });
  });

  it("contabiliza falha quando a RPC de canal ausente falha", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const order = openTicket(3, "8a845b40-7c4e-4d25-9f3f-3cbd27f050c9");
    const client = clientMock({
      orders: [order],
      guilds: [
        {
          id: order.guild_id,
          discord_guild_id: "123456789012345678",
        },
      ],
      rpcResult: {
        data: null,
        error: { message: "database unavailable" },
      },
    });
    mocks.synchronizeOpenDiscordTicketControls.mockRejectedValueOnce(
      new mocks.DiscordTicketChannelMissingError(
        order.id,
        order.discord_ticket_channel_id,
      ),
    );

    await expect(
      synchronizeAllOpenDiscordTicketControls({ client: client as never }),
    ).resolves.toMatchObject({
      processed: 1,
      synchronized: 0,
      missingChannelsClosed: 0,
      failed: 1,
    });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("database unavailable"),
    );
  });

  it("não reconcilia 404 posterior que não seja o canal inicial", async () => {
    const order = openTicket(4, "8a845b40-7c4e-4d25-9f3f-3cbd27f050c9");
    const client = clientMock({
      orders: [order],
      guilds: [
        {
          id: order.guild_id,
          discord_guild_id: "123456789012345678",
        },
      ],
    });
    mocks.synchronizeOpenDiscordTicketControls.mockRejectedValueOnce(
      new Error("Discord recusou a mensagem posterior (404)."),
    );

    await expect(
      synchronizeAllOpenDiscordTicketControls({ client: client as never }),
    ).resolves.toMatchObject({
      processed: 1,
      synchronized: 0,
      missingChannelsClosed: 0,
      failed: 1,
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("não reconcilia falha de identidade causada por application ID ausente", async () => {
    const order = openTicket(5, "8a845b40-7c4e-4d25-9f3f-3cbd27f050c9");
    const client = clientMock({
      orders: [order],
      guilds: [
        {
          id: order.guild_id,
          discord_guild_id: "123456789012345678",
        },
      ],
    });
    mocks.synchronizeOpenDiscordTicketControls.mockRejectedValueOnce(
      new Error("DISCORD_APPLICATION_ID não configurado ou inválido."),
    );

    await expect(
      synchronizeAllOpenDiscordTicketControls({ client: client as never }),
    ).resolves.toMatchObject({
      processed: 1,
      synchronized: 0,
      missingChannelsClosed: 0,
      failed: 1,
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("retorna vazio sem consultar servidores quando não há tickets abertos", async () => {
    const client = clientMock({ orders: [], guilds: [] });

    await expect(
      synchronizeAllOpenDiscordTicketControls({ client: client as never }),
    ).resolves.toEqual({
      processed: 0,
      synchronized: 0,
      missingChannelsClosed: 0,
      failed: 0,
      permissionsUpdated: 0,
      welcomeMessagesUpdated: 0,
    });
    expect(client.guildIn).not.toHaveBeenCalled();
    expect(mocks.synchronizeOpenDiscordTicketControls).not.toHaveBeenCalled();
  });

  it("pagina deterministicamente e agrega todos os tickets acima de 500", async () => {
    const guildId = "8a845b40-7c4e-4d25-9f3f-3cbd27f050c9";
    const orders = Array.from({ length: 1_205 }, (_, index) => openTicket(index, guildId));
    const client = clientMock({
      orders: [...orders].reverse(),
      guilds: [{ id: guildId, discord_guild_id: "123456789012345678" }],
    });
    let active = 0;
    let maximumActive = 0;
    mocks.synchronizeOpenDiscordTicketControls.mockImplementation(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return { permissionsUpdated: true, welcomeMessageUpdated: true };
    });

    await expect(
      synchronizeAllOpenDiscordTicketControls({ client: client as never, concurrency: 7 }),
    ).resolves.toEqual({
      processed: 1_205,
      synchronized: 1_205,
      missingChannelsClosed: 0,
      failed: 0,
      permissionsUpdated: 1_205,
      welcomeMessagesUpdated: 1_205,
    });

    expect(client.orderOrder).toHaveBeenCalledTimes(3);
    expect(client.orderOrder).toHaveBeenCalledWith("id", { ascending: true });
    expect(client.orderLimit).toHaveBeenCalledTimes(3);
    expect(client.orderLimit).toHaveBeenCalledWith(500);
    expect(client.pageCursors).toEqual([null, orders[499].id, orders[999].id]);
    expect(client.orderGt).toHaveBeenNthCalledWith(1, "id", orders[499].id);
    expect(client.orderGt).toHaveBeenNthCalledWith(2, "id", orders[999].id);
    expect(client.guildIn).toHaveBeenCalledTimes(3);
    expect(mocks.loadBotRuntimeSettingsStrict).toHaveBeenCalledOnce();
    expect(mocks.synchronizeOpenDiscordTicketControls).toHaveBeenCalledTimes(1_205);
    expect(maximumActive).toBeGreaterThan(1);
    expect(maximumActive).toBeLessThanOrEqual(7);
  });
});

function openTicket(index: number, guildId: string) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    guild_id: guildId,
    buyer_discord_id: (223456789012345678n + BigInt(index)).toString(),
    discord_ticket_channel_id: (423456789012345678n + BigInt(index)).toString(),
  };
}

function clientMock(input: {
  orders: Array<Record<string, unknown>>;
  guilds: Array<{ id: string; discord_guild_id: string }>;
  rpcResult?: {
    data: Record<string, unknown> | null;
    error: { message: string } | null;
  };
}) {
  const orderGt = vi.fn();
  const orderOrder = vi.fn();
  const orderLimit = vi.fn();
  const pageCursors: Array<string | null> = [];
  const guildIn = vi.fn(async (_column: string, ids: string[]) => ({
    data: input.guilds.filter((guild) => ids.includes(guild.id)),
    error: null,
  }));
  const guildSelect = vi.fn(() => ({ in: guildIn }));
  const rpcSingle = vi.fn(async () => input.rpcResult ?? { data: null, error: null });
  const rpc = vi.fn(() => ({ single: rpcSingle }));
  const from = vi.fn((table: string) => {
    if (table !== "orders") return { select: guildSelect };

    let afterOrderId: string | null = null;
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      not: vi.fn(() => query),
      gt: vi.fn((column: string, value: string) => {
        orderGt(column, value);
        afterOrderId = value;
        return query;
      }),
      order: vi.fn((column: string, options: { ascending: boolean }) => {
        orderOrder(column, options);
        return query;
      }),
      limit: vi.fn(async (pageSize: number) => {
        orderLimit(pageSize);
        pageCursors.push(afterOrderId);
        const data = input.orders
          .filter(
            (order) =>
              afterOrderId === null ||
              (typeof order.id === "string" && order.id > afterOrderId),
          )
          .toSorted((left, right) => String(left.id).localeCompare(String(right.id)))
          .slice(0, pageSize);
        return { data, error: null };
      }),
    };
    return query;
  });
  return {
    from,
    rpc,
    rpcSingle,
    guildIn,
    orderGt,
    orderOrder,
    orderLimit,
    pageCursors,
  };
}
