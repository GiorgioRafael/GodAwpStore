import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/brand", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/brand")>(), IS_GWSTORE: true,
}));

import {
  resolveGwStoreTicketCategoryId,
  synchronizeGwStoreTicketCategories,
  type TicketCategoryChannel,
} from "./discord-ticket-categories";

const guildId = "1401264061101899820";
const botId = "123456789012345678";
const purchaseId = "223456789012345678";
const saleId = "323456789012345678";
const uuid = "7b5c3643-6a3f-4a2b-8f27-4cf06dd2eb4f";
const uuid2 = "9b5c3643-6a3f-4a2b-8f27-4cf06dd2eb4f";
const permissions = [
  { id: guildId, type: 0 as const, allow: "0", deny: (1n << 10n).toString() },
  { id: botId, type: 1 as const, allow: ((1n << 10n) | (1n << 4n)).toString(), deny: "0" },
];
type Call = { path: string; method: string; body: Record<string, unknown> | unknown[]; signal?: AbortSignal | null };

function category(id: string, name: string, position: number): TicketCategoryChannel {
  return { id, name, type: 4, position, guild_id: guildId, permission_overwrites: structuredClone(permissions) };
}

function ticket(id: string, topic: string, parentId = "823456789012345678"): TicketCategoryChannel {
  return { id, type: 0, guild_id: guildId, name: `✅・concluido-${id.slice(-6)}`, topic, parent_id: parentId,
    permission_overwrites: [
      { id: guildId, type: 0, allow: "0", deny: (1n << 10n).toString() },
      { id: "723456789012345678", type: 1, allow: (1n << 10n).toString(), deny: (1n << 11n).toString() },
    ] };
}

function fakeDiscord(initial: TicketCategoryChannel[] = []) {
  const channels = structuredClone(initial);
  const calls: Call[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname.replace("/api/v10", "");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    calls.push({ path, method, body, signal: init?.signal });
    if (path === "/users/@me") return Response.json({ id: botId, bot: true });
    if (path === `/guilds/${guildId}/channels`) {
      if (method === "GET") return Response.json(channels);
      if (method === "POST") {
        const row: TicketCategoryChannel = {
          id: body.name === "🛒┊COMPRA" ? purchaseId : saleId,
          guild_id: guildId,
          position: channels.filter(channel => channel.type === 4).length,
          ...body,
        };
        channels.push(row);
        return Response.json(row);
      }
      if (method === "PATCH") {
        for (const change of body) {
          const channel = channels.find(channel => channel.id === change.id)!;
          channel.position = change.position;
        }
        return new Response(null, { status: 204 });
      }
    }
    const match = path.match(/^\/channels\/(\d+)$/);
    if (match && method === "PATCH") {
      const channel = channels.find(channel => channel.id === match[1])!;
      Object.assign(channel, body);
      return Response.json(channel);
    }
    throw new Error(`Unexpected ${method} ${path}`);
  }) as unknown as typeof fetch;
  return { fetcher, channels, calls };
}

beforeEach(() => {
  vi.stubEnv("DISCORD_APPLICATION_ID", botId);
  vi.stubEnv("DISCORD_BOT_TOKEN", "test-token");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("categorias de tickets da GWStore", () => {
  it("cria apenas duas categorias privadas, ordena no topo e preserva a ordem das outras", async () => {
    const discord = fakeDiscord([
      category("623456789012345678", "🛒┊Comprar", 0),
      category("523456789012345678", "BLOX FRUITS", 1),
      category("423456789012345678", "COMUNIDADE", 2),
    ]);
    const result = await synchronizeGwStoreTicketCategories(discord);
    expect(result).toMatchObject({ status: "synchronized", purchaseCategoryId: purchaseId, saleCategoryId: saleId,
      createdCategoryIds: [purchaseId, saleId], movedChannelIds: [] });
    const created = discord.calls.filter(call => call.method === "POST");
    expect(created).toHaveLength(2);
    for (const call of created) {
      expect(call.body).toMatchObject({ type: 4, permission_overwrites: permissions });
      expect(call.signal).toBeInstanceOf(AbortSignal);
    }
    const reorder = discord.calls.find(call => call.path === `/guilds/${guildId}/channels` && call.method === "PATCH")!;
    expect(reorder.body).toEqual([
      { id: purchaseId, position: 0 }, { id: saleId, position: 1 },
      { id: "623456789012345678", position: 2 }, { id: "523456789012345678", position: 3 },
      { id: "423456789012345678", position: 4 },
    ]);
    discord.calls.length = 0;
    await synchronizeGwStoreTicketCategories(discord);
    expect(discord.calls.every(call => call.method === "GET")).toBe(true);
  });

  it("move todas as fontes conhecidas sem alterar tickets concluídos", async () => {
    const purchaseTopics = [
      `gwstore-order:${uuid}`, `gwstore-order:${uuid};welcome=1`, `gwstore:late-payment:${uuid}`,
      `gwstore:roulette-redemption:${uuid}`, `gwstore:giveaway:${uuid}`, `gwstore:giveaway:${uuid}:winner:${uuid2}`,
      `gwstore:giveaway:${uuid};welcome=1`, `gwstore:giveaway:${uuid}:winner:${uuid2};welcome=1`,
    ];
    const purchaseTickets = purchaseTopics.map((topic, index) => ticket(String(623456789012345670n + BigInt(index)), topic));
    const sellingTicket = ticket("723456789012345670", `gwstore-item-offer:${JSON.stringify({
      requestId: "923456789012345678", sellerId: "823456789012345678", itemName: "Dragon West", status: "completed",
      welcomeId: "923456789012345679", completedBy: botId,
    })}`);
    const originals = [...purchaseTickets, sellingTicket];
    const discord = fakeDiscord([
      category(purchaseId, "🛒┊COMPRA", 0), category(saleId, "📦┊VENDA", 1), ...originals,
    ]);
    const result = await synchronizeGwStoreTicketCategories(discord);
    expect(result).toMatchObject({ movedChannelIds: originals.map(channel => channel.id) });
    const patches = discord.calls.filter(call => call.method === "PATCH");
    expect(patches).toHaveLength(originals.length);
    for (const patch of patches) expect(patch.body).toEqual({ parent_id: patch.path.endsWith(sellingTicket.id) ? saleId : purchaseId });
    for (const before of originals) {
      const after = discord.channels.find(channel => channel.id === before.id)!;
      expect({ ...after, parent_id: before.parent_id }).toEqual(before);
    }
    discord.calls.length = 0;
    await synchronizeGwStoreTicketCategories(discord);
    expect(discord.calls.every(call => call.method === "GET")).toBe(true);
  });

  it("não usa nomes para classificar, ignora markers inválidos e canais estrangeiros", async () => {
    const unknown = [
      ticket("423456789012345670", ""),
      ticket("423456789012345671", "gwstore-order:not-a-uuid"),
      ticket("423456789012345672", `gwstore-order:${uuid};anything=1`),
      ticket("423456789012345673", `gwstore:giveaway:${uuid}:winner:not-a-uuid`),
      ticket("423456789012345674", 'gwstore-item-offer:{"itemName":"Dragon"}'),
      ticket("423456789012345675", "gwstore-item-offer:null"),
      { ...ticket("423456789012345676", `gwstore-order:${uuid}`), guild_id: "923456789012345678" },
    ];
    unknown[0].name = "ticket-compra-venda";
    const discord = fakeDiscord([category(purchaseId, "🛒┊COMPRA", 0), category(saleId, "📦┊VENDA", 1), ...unknown]);
    const result = await synchronizeGwStoreTicketCategories(discord);
    expect(result).toMatchObject({ movedChannelIds: [] });
    expect(discord.channels.slice(2)).toEqual(unknown);
    expect(discord.calls.every(call => call.method === "GET")).toBe(true);
  });

  it("recusa categoria duplicada e não realiza mutações", async () => {
    const rows = [category(purchaseId, "🛒┊COMPRA", 0), category("423456789012345678", "Compra", 1)];
    const discord = fakeDiscord(rows);
    await expect(resolveGwStoreTicketCategoryId(guildId, "purchase", rows, discord.fetcher)).rejects.toThrow("mais de uma categoria");
    expect(discord.calls).toEqual([]);
    await expect(synchronizeGwStoreTicketCategories(discord)).rejects.toThrow("mais de uma categoria");
    expect(discord.calls.every(call => call.method === "GET")).toBe(true);
  });

  it("resolve categoria existente sem request e cria com identidade validada quando falta", async () => {
    const existing = fakeDiscord([category(purchaseId, "🛒┊COMPRA", 0)]);
    expect(await resolveGwStoreTicketCategoryId(guildId, "purchase", existing.channels, existing.fetcher)).toBe(purchaseId);
    expect(existing.calls).toEqual([]);
    const missing = fakeDiscord();
    const ids = await Promise.all([
      resolveGwStoreTicketCategoryId(guildId, "purchase", [], missing.fetcher),
      resolveGwStoreTicketCategoryId(guildId, "sale", [], missing.fetcher),
    ]);
    expect(ids).toEqual([purchaseId, saleId]);
    expect(missing.calls.filter(call => call.method === "POST")).toHaveLength(2);
    // A stale list is refreshed before creation on a later retry.
    expect(await resolveGwStoreTicketCategoryId(guildId, "sale", [], missing.fetcher)).toBe(saleId);
    expect(missing.calls.filter(call => call.method === "POST")).toHaveLength(2);
  });

  it("não faz requests para outro servidor", async () => {
    const discord = fakeDiscord();
    expect(await resolveGwStoreTicketCategoryId("923456789012345678", "purchase", [], discord.fetcher)).toBeNull();
    expect(discord.calls).toEqual([]);
  });

  it("não organiza canais nem resolve categorias em THStore", async () => {
    vi.resetModules();
    vi.doMock("@/lib/brand", async importOriginal => ({
      ...await importOriginal<typeof import("@/lib/brand")>(), IS_GWSTORE: false,
    }));
    try {
      const th = await import("./discord-ticket-categories");
      const discord = fakeDiscord();
      expect(await th.resolveGwStoreTicketCategoryId(guildId, "purchase", [], discord.fetcher)).toBeNull();
      expect(await th.synchronizeGwStoreTicketCategories(discord)).toEqual({ status: "disabled" });
      expect(discord.calls).toEqual([]);
    } finally {
      vi.doMock("@/lib/brand", async importOriginal => ({
        ...await importOriginal<typeof import("@/lib/brand")>(), IS_GWSTORE: true,
      }));
      vi.resetModules();
    }
  });

  it("falha se a movimentação alterar permissões ou o Discord não confirmar a posição", async () => {
    const discord = fakeDiscord([category(purchaseId, "🛒┊COMPRA", 0), category(saleId, "📦┊VENDA", 1),
      ticket("423456789012345670", `gwstore-order:${uuid}`)]);
    const original = discord.fetcher;
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      const response = await original(url, init);
      if (init?.method === "PATCH" && String(url).endsWith("/channels/423456789012345670")) {
        discord.channels[2].permission_overwrites = [];
      }
      return response;
    }) as typeof fetch;
    await expect(synchronizeGwStoreTicketCategories({ fetcher })).rejects.toThrow("preservação do ticket");
    const wrongOrder = fakeDiscord([category(purchaseId, "🛒┊COMPRA", 3), category(saleId, "📦┊VENDA", 4)]);
    const failReorder = (async (url: string | URL | Request, init?: RequestInit) => init?.method === "PATCH"
      ? new Response(null, { status: 204 }) : wrongOrder.fetcher(url, init)) as typeof fetch;
    await expect(synchronizeGwStoreTicketCategories({ fetcher: failReorder })).rejects.toThrow("ordem das categorias");
  });
});
