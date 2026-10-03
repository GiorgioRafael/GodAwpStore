import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { completeItemSellingInteraction, synchronizeGwStoreItemSelling } from "./discord-item-selling-server";
import { DEFAULT_BOT_MESSAGE_CUSTOMIZATION } from "./message-customization";
import { GODAWP_DISCORD_USER_ID, GWSTORE_SELLING_GUILD_ID, SELLING_COMPLETE_PREFIX, SELLING_ENTRY_TOPIC,
  SELLING_ENTRY_TITLE, SELLING_SUBMIT_ID, SELLING_TICKET_TOPIC } from "./discord-item-selling";

const botId = "123456789012345678";
const entryId = "223456789012345678";
const sellerId = "323456789012345678";
const ticketId = "423456789012345678";
const settings = { customization: DEFAULT_BOT_MESSAGE_CUSTOMIZATION, ticketCloseAdminDiscordUserIds: [], ticketNotificationDiscordUserIds: [] };
type FakeChannel = { id: string; type: number; guild_id: string; name: string; topic?: string; permission_overwrites?: Array<{id:string;type:number;allow:string;deny:string}> };
type FakeMessage = { id: string; author: {id:string}; embeds?: Array<{title?: string; footer?: {text?:string}}>; content?: string; components?: unknown };

function fakeDiscord() {
  const channels: FakeChannel[] = [{ id: entryId, type: 0, guild_id: GWSTORE_SELLING_GUILD_ID, name: "📦┊vender-itens", topic: SELLING_ENTRY_TOPIC }];
  const messages = new Map<string, FakeMessage[]>([[entryId, []]]);
  const calls: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
  let sequence = 523456789012345678n;
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname.replace("/api/v10", "");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    calls.push({ path, method, body });
    const result = (value: unknown) => Response.json(value);
    if (path === "/users/@me") return result({ id: botId, bot: true });
    if (path === `/guilds/${GWSTORE_SELLING_GUILD_ID}/channels`) {
      if (method === "POST") {
        const channel = { id: ticketId, guild_id: GWSTORE_SELLING_GUILD_ID, ...body } as FakeChannel;
        channels.push(channel); messages.set(channel.id, []); return result(channel);
      }
      return result(channels);
    }
    if (path.startsWith("/webhooks/")) return result({ id: "response" });
    const match = path.match(/^\/channels\/(\d+)(?:\/messages(?:\/(\d+))?)?$/);
    if (match) {
      const channel = channels.find(row => row.id === match[1]);
      if (!channel) return Response.json({ code: 10003 }, { status: 404 });
      if (!path.includes("/messages")) { if (method === "PATCH") Object.assign(channel, body); return result(channel); }
      const list = messages.get(channel.id)!;
      if (method === "GET") return result(list);
      if (method === "POST") { const message = { id: String(sequence++), author: { id: botId }, ...body }; list.push(message); return result(message); }
      const message = list.find(row => row.id === match[2]);
      if (message) { Object.assign(message, body); return result(message); }
    }
    throw new Error(`Unexpected ${method} ${path}`);
  }) as unknown as typeof fetch;
  return { channels, messages, calls, fetcher };
}
function raw(kind: "submit" | "complete" = "submit", userId = sellerId) {
  return { type: kind === "submit" ? 5 : 3, id: "623456789012345678", application_id: botId,
    token: "abcdefghijklmnopqrstuvwxyz0123456789", guild_id: GWSTORE_SELLING_GUILD_ID,
    channel_id: kind === "submit" ? entryId : ticketId, member: { user: { id: userId } },
    data: { custom_id: kind === "submit" ? SELLING_SUBMIT_ID : `${SELLING_COMPLETE_PREFIX}${ticketId}`,
      components: [{ component: { custom_id: "item_name", value: "Dragon Física" } }] },
  };
}
beforeEach(() => { vi.stubEnv("DISCORD_APPLICATION_ID", botId); vi.stubEnv("DISCORD_BOT_TOKEN", "test-token"); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("tickets para vendedores", () => {
  it("publica o canal só leitura e reutiliza a mesma mensagem", async () => {
    const discord = fakeDiscord();
    await synchronizeGwStoreItemSelling(discord);
    await synchronizeGwStoreItemSelling(discord);
    const permissions = discord.channels[0].permission_overwrites!;
    const everyone = permissions.find(row => row.id === GWSTORE_SELLING_GUILD_ID)!;
    expect(BigInt(everyone.deny) & (1n << 11n)).not.toBe(0n);
    expect(BigInt(permissions.find(row => row.id === botId)!.allow) & (1n << 11n)).not.toBe(0n);
    expect(discord.messages.get(entryId)).toHaveLength(1);
    expect(discord.messages.get(entryId)![0].embeds?.[0].title).toBe(SELLING_ENTRY_TITLE);
  });
  it("abre ticket privado com item, marca somente vendedor e GodAwp e evita duplicatas", async () => {
    const discord = fakeDiscord();
    await Promise.all([completeItemSellingInteraction(raw(), { ...discord, settings }), completeItemSellingInteraction(raw(), { ...discord, settings })]);
    await completeItemSellingInteraction({ ...raw(), id: "723456789012345678" }, { ...discord, settings });
    const ticket = discord.channels.find(row => row.id === ticketId)!;
    expect(ticket.topic).toContain(SELLING_TICKET_TOPIC);
    expect(ticket.permission_overwrites?.find(row => row.id === GWSTORE_SELLING_GUILD_ID)?.deny).toBe((1n << 10n).toString());
    for (const id of [sellerId, GODAWP_DISCORD_USER_ID, botId]) expect(ticket.permission_overwrites?.some(row => row.id === id && row.type === 1)).toBe(true);
    expect(discord.calls.filter(call => call.method === "POST" && call.path.endsWith("/channels"))).toHaveLength(1);
    const welcome = discord.calls.filter(call => call.method === "POST" && call.path === `/channels/${ticketId}/messages`);
    expect(welcome).toHaveLength(1);
    expect(welcome[0].body).toMatchObject({ content: `<@${GODAWP_DISCORD_USER_ID}> <@${sellerId}>`,
      allowed_mentions: { parse: [], users: [GODAWP_DISCORD_USER_ID, sellerId] },
      embeds: [{ description: expect.stringContaining("Dragon Física") }],
      components: [{ components: [{ label: "Concluir ticket", custom_id: `${SELLING_COMPLETE_PREFIX}${ticketId}` }] }],
    });
  });
  it("conclui, renomeia, bloqueia o vendedor e preserva o histórico sem publicar duplicatas", async () => {
    const discord = fakeDiscord();
    await completeItemSellingInteraction(raw(), { ...discord, settings });
    await completeItemSellingInteraction(raw("complete", GODAWP_DISCORD_USER_ID), { ...discord, settings });
    await completeItemSellingInteraction(raw("complete", GODAWP_DISCORD_USER_ID), { ...discord, settings });
    const ticket = discord.channels.find(row => row.id === ticketId)!;
    expect(ticket.name).toBe("✅・concluido-venda-dragon-fisica-345678");
    expect(ticket.topic).toContain('"status":"completed"');
    const seller = ticket.permission_overwrites!.find(row => row.id === sellerId)!;
    expect(BigInt(seller.deny) & (1n << 11n)).not.toBe(0n);
    expect(BigInt(seller.allow) & (1n << 10n)).not.toBe(0n);
    expect(discord.messages.get(ticketId)).toHaveLength(2);
    expect(discord.messages.get(ticketId)![0].components).toMatchObject([{ components: [{ disabled: true, label: "Ticket concluído" }] }]);
    expect(discord.calls.some(call => call.method === "DELETE")).toBe(false);
  });
  it("recusa conclusão pelo vendedor e formulário vindo de outro canal", async () => {
    const discord = fakeDiscord();
    await completeItemSellingInteraction(raw(), { ...discord, settings });
    discord.calls.length = 0;
    await completeItemSellingInteraction(raw("complete"), { ...discord, settings });
    expect(discord.calls.some(call => call.path.startsWith("/channels/") && call.method === "PATCH")).toBe(false);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await completeItemSellingInteraction({ ...raw(), channel_id: ticketId }, { ...discord, settings });
    expect(discord.calls.some(call => call.method === "POST")).toBe(false);
    expect(errorLog).toHaveBeenCalled();
  });
  it("rejeita qualquer interação de outro servidor sem chamar o Discord", async () => {
    const discord = fakeDiscord();
    await completeItemSellingInteraction({ ...raw(), guild_id: entryId }, { ...discord, settings });
    expect(discord.fetcher).not.toHaveBeenCalled();
  });
  it("recupera canal e mensagem após timeout sem abrir outro ticket nem marcar as pessoas novamente", async () => {
    const discord = fakeDiscord();
    const originalFetch = discord.fetcher;
    let failOnce = true;
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      const response = await originalFetch(url, init);
      if (failOnce && init?.method === "POST" && String(url).endsWith(`/channels/${ticketId}/messages`)) {
        failOnce = false;
        throw new Error("Simulated timeout after Discord saved the message");
      }
      return response;
    }) as typeof fetch;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await completeItemSellingInteraction(raw(), { fetcher, settings });
    await completeItemSellingInteraction(raw(), { fetcher, settings });
    expect(discord.channels.filter(channel => channel.id === ticketId)).toHaveLength(1);
    expect(discord.messages.get(ticketId)).toHaveLength(1);
    expect(discord.calls.filter(call => call.method === "POST" && call.path === `/channels/${ticketId}/messages`)).toHaveLength(1);
  });
});
