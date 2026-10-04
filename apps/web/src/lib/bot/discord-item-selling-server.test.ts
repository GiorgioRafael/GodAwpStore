import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { completeItemSellingInteraction, reconcileCompletedGwStoreItemSellingTickets, synchronizeGwStoreItemSelling } from "./discord-item-selling-server";
import { DEFAULT_BOT_MESSAGE_CUSTOMIZATION } from "./message-customization";
import { GODAWP_DISCORD_USER_ID, GWSTORE_SELLING_GUILD_ID, SELLING_COMPLETE_PREFIX, SELLING_ENTRY_TOPIC,
  SELLING_ENTRY_TITLE, SELLING_SUBMIT_ID, SELLING_TICKET_TOPIC, SELLING_CLOSE_CONFIRM_PREFIX, SELLING_CLOSE_PREFIX, SELLING_CLOSE_CANCEL_PREFIX } from "./discord-item-selling";

const botId = "123456789012345678";
const entryId = "223456789012345678";
const sellerId = "323456789012345678";
const ticketId = "423456789012345678";
const purchaseCategoryId = "823456789012345678";
const saleCategoryId = "923456789012345678";
const settings = { customization: DEFAULT_BOT_MESSAGE_CUSTOMIZATION, ticketCloseAdminDiscordUserIds: [], ticketNotificationDiscordUserIds: [] };
type FakeChannel = { id: string; type: number; guild_id: string; name: string; topic?: string; parent_id?: string | null; permission_overwrites?: Array<{id:string;type:number;allow:string;deny:string}> };
type FakeMessage = { id: string; timestamp?: string; author: {id:string}; embeds?: Array<{title?: string; footer?: {text?:string}}>; content?: string; components?: unknown };

function fakeDiscord() {
  const channels: FakeChannel[] = [
    { id: entryId, type: 0, guild_id: GWSTORE_SELLING_GUILD_ID, name: "📦┊vender-itens", topic: SELLING_ENTRY_TOPIC, parent_id: purchaseCategoryId },
    { id: purchaseCategoryId, type: 4, guild_id: GWSTORE_SELLING_GUILD_ID, name: "🛒┊COMPRA" },
    { id: saleCategoryId, type: 4, guild_id: GWSTORE_SELLING_GUILD_ID, name: "📦┊VENDA" },
  ];
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
      if (!path.includes("/messages")) {
        if (method === "DELETE") { channels.splice(channels.indexOf(channel), 1); return result(channel); }
        if (method === "PATCH") Object.assign(channel, body); return result(channel);
      }
      const list = messages.get(channel.id)!;
      if (method === "GET") return match[2] ? result(list.find(row => row.id === match[2])) : result(list);
      if (method === "POST") { const message = { id: String(sequence++), author: { id: botId }, ...body }; list.push(message); return result(message); }
      const message = list.find(row => row.id === match[2]);
      if (message) { Object.assign(message, body); return result(message); }
    }
    throw new Error(`Unexpected ${method} ${path}`);
  }) as unknown as typeof fetch;
  return { channels, messages, calls, fetcher };
}
function raw(kind: "submit" | "complete" | "close_confirm" | "close_request" | "close_cancel" = "submit", userId = sellerId) {
  return { type: kind === "submit" ? 5 : 3, id: "623456789012345678", application_id: botId,
    token: "abcdefghijklmnopqrstuvwxyz0123456789", guild_id: GWSTORE_SELLING_GUILD_ID,
    channel_id: kind === "submit" ? entryId : ticketId, member: { user: { id: userId } },
    data: { custom_id: kind === "submit" ? SELLING_SUBMIT_ID : `${{
        complete: SELLING_COMPLETE_PREFIX, close_confirm: SELLING_CLOSE_CONFIRM_PREFIX,
        close_request: SELLING_CLOSE_PREFIX, close_cancel: SELLING_CLOSE_CANCEL_PREFIX,
      }[kind]}${ticketId}`,
      components: [{ component: { custom_id: "item_name", value: "Dragon Física" } }] },
  };
}
beforeEach(() => { vi.stubEnv("DISCORD_APPLICATION_ID", botId); vi.stubEnv("DISCORD_BOT_TOKEN", "test-token"); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("tickets para vendedores", () => {
  it("publica o canal só leitura e reutiliza a mesma mensagem", async () => {
    const discord = fakeDiscord();
    // Migrate the technical topic from the first deployment without duplicating the channel.
    discord.channels[0].topic = "gwstore-item-selling:v1";
    await synchronizeGwStoreItemSelling(discord);
    await synchronizeGwStoreItemSelling(discord);
    const permissions = discord.channels[0].permission_overwrites!;
    const everyone = permissions.find(row => row.id === GWSTORE_SELLING_GUILD_ID)!;
    expect(BigInt(everyone.deny) & (1n << 11n)).not.toBe(0n);
    expect(BigInt(permissions.find(row => row.id === botId)!.allow) & (1n << 11n)).not.toBe(0n);
    expect(discord.messages.get(entryId)).toHaveLength(1);
    expect(discord.channels).toHaveLength(3);
    expect(discord.channels[0].topic).toBe(SELLING_ENTRY_TOPIC);
    expect(discord.messages.get(entryId)![0].embeds?.[0].title).toBe(SELLING_ENTRY_TITLE);
  });
  it("abre ticket privado com item, marca somente vendedor e GodAwp e evita duplicatas", async () => {
    const discord = fakeDiscord();
    await Promise.all([completeItemSellingInteraction(raw(), { ...discord, settings }), completeItemSellingInteraction(raw(), { ...discord, settings })]);
    await completeItemSellingInteraction({ ...raw(), id: "723456789012345678" }, { ...discord, settings });
    const ticket = discord.channels.find(row => row.id === ticketId)!;
    expect(ticket.parent_id).toBe(saleCategoryId);
    expect(ticket.topic).toContain(SELLING_TICKET_TOPIC);
    expect(ticket.permission_overwrites?.find(row => row.id === GWSTORE_SELLING_GUILD_ID)?.deny).toBe((1n << 10n).toString());
    for (const id of [sellerId, GODAWP_DISCORD_USER_ID, botId]) expect(ticket.permission_overwrites?.some(row => row.id === id && row.type === 1)).toBe(true);
    expect(discord.calls.filter(call => call.method === "POST" && call.path.endsWith("/channels"))).toHaveLength(1);
    const welcome = discord.calls.filter(call => call.method === "POST" && call.path === `/channels/${ticketId}/messages`);
    expect(welcome).toHaveLength(1);
    expect(welcome[0].body).toMatchObject({ content: `<@${GODAWP_DISCORD_USER_ID}> <@${sellerId}>`,
      allowed_mentions: { parse: [], users: [GODAWP_DISCORD_USER_ID, sellerId] },
      embeds: [{ description: expect.stringContaining("Dragon Física") }],
      components: [{ components: [{ label: "Concluir ticket", custom_id: `${SELLING_COMPLETE_PREFIX}${ticketId}` }, { label: "Fechar ticket", custom_id: `${SELLING_CLOSE_PREFIX}${ticketId}` }] }],
    });
  });
  it("move atendimento recuperado para Venda sem mudar suas permissões ou duplicar mensagens", async () => {
    const discord = fakeDiscord();
    await completeItemSellingInteraction(raw(), { ...discord, settings });
    const ticket = discord.channels.find(row => row.id === ticketId)!;
    const permissions = structuredClone(ticket.permission_overwrites);
    ticket.parent_id = purchaseCategoryId;
    discord.calls.length = 0;
    await completeItemSellingInteraction(raw(), { ...discord, settings });
    expect(ticket.parent_id).toBe(saleCategoryId);
    expect(ticket.permission_overwrites).toEqual(permissions);
    expect(discord.calls.filter(call => call.method === "PATCH" && call.path === `/channels/${ticketId}`)).toEqual([
      { path: `/channels/${ticketId}`, method: "PATCH", body: { parent_id: saleCategoryId } },
    ]);
    expect(discord.calls.some(call => call.method === "POST")).toBe(false);
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
    expect(discord.messages.get(ticketId)![0].components).toMatchObject([{ components: [{ disabled: true, label: "Ticket concluído" }, { label: "Fechar ticket" }] }]);
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

const completedAt = Date.parse("2026-10-03T23:00:00.000Z");
function offerOf(discord: ReturnType<typeof fakeDiscord>) {
  return JSON.parse(discord.channels.find(channel => channel.id === ticketId)!.topic!.slice(SELLING_TICKET_TOPIC.length)) as Record<string, unknown>;
}
function replaceOffer(discord: ReturnType<typeof fakeDiscord>, changes: Record<string, unknown>, omit: string[] = []) {
  const offer = { ...offerOf(discord), ...changes };
  for (const key of omit) delete offer[key];
  discord.channels.find(channel => channel.id === ticketId)!.topic = `${SELLING_TICKET_TOPIC}${JSON.stringify(offer)}`;
}
async function completedTicket(discord: ReturnType<typeof fakeDiscord>) {
  await completeItemSellingInteraction(raw(), { ...discord, settings });
  await completeItemSellingInteraction(raw("complete", GODAWP_DISCORD_USER_ID), { ...discord, settings, now: () => completedAt });
  discord.calls.length = 0;
}

describe("fechamento durável dos tickets de venda GWStore", () => {
  it("mantém o ticket antes dos cinco minutos e fecha ao atingir o prazo", async () => {
    const discord = fakeDiscord();
    await completedTicket(discord);
    expect(offerOf(discord).completedAt).toBe("2026-10-03T23:00:00.000Z");
    expect(await reconcileCompletedGwStoreItemSellingTickets({ ...discord, now: () => completedAt + 299_999 })).toEqual({ scanned: 1, active: 1, completed: 0, alreadyClosed: 0, failed: 0 });
    expect(discord.calls.some(call => call.method === "DELETE")).toBe(false);
    expect(await reconcileCompletedGwStoreItemSellingTickets({ ...discord, now: () => completedAt + 300_000 })).toEqual({ scanned: 1, active: 0, completed: 1, alreadyClosed: 0, failed: 0 });
    expect(discord.channels.some(channel => channel.id === ticketId)).toBe(false);
  });

  it("não reinicia o prazo quando a conclusão precisa recuperar uma falha após salvar o tópico", async () => {
    const discord = fakeDiscord();
    await completeItemSellingInteraction(raw(), { ...discord, settings });
    let fail = true;
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      const response = await discord.fetcher(url, init);
      if (fail && init?.method === "PATCH" && String(url).includes(`/channels/${ticketId}/messages/`)) {
        fail = false; throw new Error("Falha após salvar mensagem");
      }
      return response;
    }) as typeof fetch;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await completeItemSellingInteraction(raw("complete", GODAWP_DISCORD_USER_ID), { fetcher, settings, now: () => completedAt });
    await completeItemSellingInteraction(raw("complete", GODAWP_DISCORD_USER_ID), { fetcher, settings, now: () => completedAt + 240_000 });
    expect(offerOf(discord).completedAt).toBe("2026-10-03T23:00:00.000Z");
    expect(discord.messages.get(ticketId)).toHaveLength(2);
    expect(await reconcileCompletedGwStoreItemSellingTickets({ ...discord, now: () => completedAt + 300_000 })).toMatchObject({ completed: 1, failed: 0 });
  });

  it("migra legado pelo aviso de conclusão do próprio bot", async () => {
    const discord = fakeDiscord();
    await completedTicket(discord);
    replaceOffer(discord, {}, ["completedAt"]);
    discord.messages.get(ticketId)![1].timestamp = "2026-10-03T23:00:00.000Z";
    expect(await reconcileCompletedGwStoreItemSellingTickets({ ...discord, now: () => completedAt + 300_000 })).toMatchObject({ completed: 1, failed: 0 });
    expect(discord.calls.find(call => call.method === "PATCH" && call.path === `/channels/${ticketId}`)?.body.topic).toContain('"completedAt":"2026-10-03T23:00:00.000Z"');
  });

  it("agenda legado sem aviso próprio a partir de agora e preserva esse instante nos retries", async () => {
    const discord = fakeDiscord();
    await completedTicket(discord);
    replaceOffer(discord, {}, ["completedAt"]);
    discord.messages.get(ticketId)![1].author.id = sellerId;
    const now = completedAt + 3_600_000;
    expect(await reconcileCompletedGwStoreItemSellingTickets({ ...discord, now: () => now })).toMatchObject({ active: 1, completed: 0 });
    expect(offerOf(discord).completedAt).toBe(new Date(now).toISOString());
    expect(await reconcileCompletedGwStoreItemSellingTickets({ ...discord, now: () => now + 180_000 })).toMatchObject({ active: 1, completed: 0 });
    expect(offerOf(discord).completedAt).toBe(new Date(now).toISOString());
    expect(await reconcileCompletedGwStoreItemSellingTickets({ ...discord, now: () => now + 300_000 })).toMatchObject({ completed: 1 });
  });

  it("mantém abertos e ignora Ticket King, canais externos e tópicos de conclusão inválidos", async () => {
    const discord = fakeDiscord();
    await completeItemSellingInteraction(raw(), { ...discord, settings });
    const native = discord.channels.find(channel => channel.id === ticketId)!;
    const malformed = { ...offerOf(discord), status: "completed", completedBy: [], completedAt: "2026-10-03T23:00:00.000Z" };
    discord.channels.push(
      { ...native, id: "423456789012345679", name: "✅-entregue-ticketking", topic: "Ticket King" },
      { ...native, id: "423456789012345680", guild_id: entryId, topic: `${SELLING_TICKET_TOPIC}${JSON.stringify({ ...malformed, completedBy: GODAWP_DISCORD_USER_ID })}` },
      { ...native, id: "423456789012345681", topic: `${SELLING_TICKET_TOPIC}${JSON.stringify(malformed)}` },
      { ...native, id: "423456789012345682", topic: `${SELLING_TICKET_TOPIC}${JSON.stringify({ ...malformed, completedBy: GODAWP_DISCORD_USER_ID, completedAt: "amanhã" })}` },
    );
    expect(await reconcileCompletedGwStoreItemSellingTickets({ ...discord, now: () => completedAt + 999_999 })).toEqual({ scanned: 1, active: 1, completed: 0, alreadyClosed: 0, failed: 0 });
    expect(discord.calls.some(call => call.method === "DELETE")).toBe(false);
  });

  it("revalida estado fresco antes de apagar e preserva um ticket reaberto durante o cron", async () => {
    const discord = fakeDiscord();
    await completedTicket(discord);
    let channelReads = 0;
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith(`/channels/${ticketId}`) && (!init?.method || init.method === "GET") && ++channelReads === 2) replaceOffer(discord, { status: "open" });
      return discord.fetcher(url, init);
    }) as typeof fetch;
    expect(await reconcileCompletedGwStoreItemSellingTickets({ fetcher, now: () => completedAt + 300_000 })).toMatchObject({ active: 1, completed: 0, failed: 0 });
    expect(discord.calls.some(call => call.method === "DELETE")).toBe(false);
  });

  it("fecha welcome conhecida mesmo quando ela está fora das últimas mil mensagens", async () => {
    const discord = fakeDiscord();
    await completedTicket(discord);
    const actual = discord.fetcher;
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes(`/channels/${ticketId}/messages?`)) throw new Error("Este histórico não deve ser percorrido");
      return actual(url, init);
    }) as typeof fetch;
    expect(await reconcileCompletedGwStoreItemSellingTickets({ fetcher, now: () => completedAt + 300_000 })).toMatchObject({ completed: 1, failed: 0 });
  });

  it("só fecha manualmente com autorização, contexto correto e welcome do bot", async () => {
    const discord = fakeDiscord();
    await completeItemSellingInteraction(raw(), { ...discord, settings });
    discord.calls.length = 0;
    await completeItemSellingInteraction(raw("close_confirm"), { ...discord, settings });
    await completeItemSellingInteraction({ ...raw("close_confirm", GODAWP_DISCORD_USER_ID), channel_id: entryId }, { ...discord, settings });
    expect(discord.calls.some(call => call.method === "DELETE")).toBe(false);
    const welcome = discord.messages.get(ticketId)![0];
    welcome.author.id = sellerId;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await completeItemSellingInteraction(raw("close_confirm", GODAWP_DISCORD_USER_ID), { ...discord, settings });
    expect(discord.calls.some(call => call.method === "DELETE")).toBe(false);
    welcome.author.id = botId;
    await completeItemSellingInteraction(raw("close_confirm", sellerId), { ...discord, settings: { ...settings, ticketCloseAdminDiscordUserIds: [sellerId] } });
    expect(discord.calls.filter(call => call.method === "DELETE")).toHaveLength(1);
    expect(discord.calls.at(-1)?.body.content).toBe("Ticket de venda fechado.");
  });

  it("ignora pedido e cancelamento e permite fechar manualmente um concluído", async () => {
    const discord = fakeDiscord();
    await completedTicket(discord);
    await completeItemSellingInteraction(raw("close_request", GODAWP_DISCORD_USER_ID), { ...discord, settings });
    await completeItemSellingInteraction(raw("close_cancel", GODAWP_DISCORD_USER_ID), { ...discord, settings });
    expect(discord.calls).toHaveLength(0);
    await completeItemSellingInteraction(raw("close_confirm", GODAWP_DISCORD_USER_ID), { ...discord, settings });
    expect(discord.channels.some(channel => channel.id === ticketId)).toBe(false);
  });

  it("trata Unknown Channel em GET e DELETE como fechamento idempotente", async () => {
    for (const stage of ["GET", "DELETE"]) {
      const discord = fakeDiscord();
      await completedTicket(discord);
      const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith(`/channels/${ticketId}`) && (init?.method ?? "GET") === stage) return Response.json({ code: 10003 }, { status: 404 });
        return discord.fetcher(url, init);
      }) as typeof fetch;
      expect(await reconcileCompletedGwStoreItemSellingTickets({ fetcher, now: () => completedAt + 300_000 })).toMatchObject({ alreadyClosed: 1, completed: 0, failed: 0 });
    }
    const discord = fakeDiscord();
    await completeItemSellingInteraction(raw("close_confirm", GODAWP_DISCORD_USER_ID), { ...discord, settings });
    expect(discord.calls.some(call => call.method === "DELETE")).toBe(false);
    expect(discord.calls.at(-1)?.body.content).toBe("Este ticket já foi fechado.");
  });

  it.each([{ status: 403, code: 10003 }, { status: 404, code: 10008 }, { status: 500, code: 0 }])("mantém falhas $status/$code para retry, sem tratá-las como canal ausente", async ({ status, code }) => {
    const discord = fakeDiscord();
    await completedTicket(discord);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith(`/channels/${ticketId}`) && init?.method === "DELETE") return Response.json({ code }, { status });
      return discord.fetcher(url, init);
    }) as typeof fetch;
    expect(await reconcileCompletedGwStoreItemSellingTickets({ fetcher, now: () => completedAt + 300_000 })).toMatchObject({ failed: 1, alreadyClosed: 0, completed: 0 });
    expect(discord.channels.some(channel => channel.id === ticketId)).toBe(true);
    expect(await reconcileCompletedGwStoreItemSellingTickets({ ...discord, now: () => completedAt + 480_000 })).toMatchObject({ completed: 1, failed: 0 });
  });

  it("limita o lote e atualiza botões de tickets antigos sem duplicar mensagens ou alterar permissões", async () => {
    const discord = fakeDiscord();
    await completedTicket(discord);
    expect(await reconcileCompletedGwStoreItemSellingTickets({ ...discord, now: () => completedAt + 300_000, limit: 0 })).toMatchObject({ scanned: 0, completed: 0 });
    replaceOffer(discord, {}, ["completedAt"]);
    discord.messages.get(ticketId)![1].timestamp = "2026-10-03T23:00:00.000Z";
    const native = discord.channels.find(channel => channel.id === ticketId)!;
    const permissions = structuredClone(native.permission_overwrites);
    const count = discord.messages.get(ticketId)!.length;
    const synchronized = await synchronizeGwStoreItemSelling(discord);
    expect(synchronized).toMatchObject({ ticketsScanned: 1, ticketsUpdated: 1, ticketsFailed: 0, legacyCompletionTimesMigrated: 1 });
    expect(offerOf(discord).completedAt).toBe("2026-10-03T23:00:00.000Z");
    expect(native.permission_overwrites).toEqual(permissions);
    expect(discord.messages.get(ticketId)).toHaveLength(count);
    expect(discord.messages.get(ticketId)![0].content).toBe(`<@${GODAWP_DISCORD_USER_ID}> <@${sellerId}>`);
    expect(discord.messages.get(ticketId)![0].components).toMatchObject([{ components: [{ disabled: true }, { label: "Fechar ticket" }] }]);
    expect((discord.messages.get(ticketId)![0].components as Array<{components:Array<{disabled?:boolean}>}>)[0].components[1].disabled).not.toBe(true);
    expect(discord.calls.some(call => call.method === "DELETE")).toBe(false);
  });
});

describe("limites e confirmação do fechamento de venda", () => {
  it("limita a cem atendimentos mesmo quando o chamador pede mais", async () => {
    const discord = fakeDiscord();
    await completedTicket(discord);
    const native = discord.channels.find(channel => channel.id === ticketId)!;
    const welcome = discord.messages.get(ticketId)![0];
    for (let index = 1; index <= 101; index++) {
      const id = String(BigInt(ticketId) + BigInt(index));
      discord.channels.push({ ...native, id });
      discord.messages.set(id, [structuredClone(welcome)]);
    }
    expect(await reconcileCompletedGwStoreItemSellingTickets({ ...discord, now: () => completedAt + 60_000, limit: 500 })).toEqual({ scanned: 100, active: 100, completed: 0, alreadyClosed: 0, failed: 0 });
    expect(discord.calls.some(call => call.method === "DELETE")).toBe(false);
  });

  it("não reporta sucesso quando o Discord confirma outro canal", async () => {
    const discord = fakeDiscord();
    await completedTicket(discord);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith(`/channels/${ticketId}`) && init?.method === "DELETE") return Response.json({ id: entryId, guild_id: GWSTORE_SELLING_GUILD_ID });
      return discord.fetcher(url, init);
    }) as typeof fetch;
    expect(await reconcileCompletedGwStoreItemSellingTickets({ fetcher, now: () => completedAt + 300_000 })).toMatchObject({ failed: 1, completed: 0, alreadyClosed: 0 });
  });
});

describe("migração conservadora com histórico grande", () => {
  it("agenda agora quando o aviso legado está fora do histórico acessível, sem duplicá-lo na sincronização", async () => {
    const discord = fakeDiscord();
    await completedTicket(discord);
    replaceOffer(discord, {}, ["completedAt"]);
    const longPage: FakeMessage[] = Array.from({ length: 100 }, (_, index) => ({ id: String(923456789012345678n - BigInt(index)), author: { id: sellerId }, content: "Conversa antiga" }));
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes(`/channels/${ticketId}/messages?`)) return Response.json(longPage);
      return discord.fetcher(url, init);
    }) as typeof fetch;
    const now = completedAt + 3_600_000;
    expect(await reconcileCompletedGwStoreItemSellingTickets({ fetcher, now: () => now })).toMatchObject({ active: 1, completed: 0, failed: 0 });
    expect(offerOf(discord).completedAt).toBe(new Date(now).toISOString());
    discord.calls.length = 0;
    await synchronizeGwStoreItemSelling({ fetcher });
    expect(discord.messages.get(ticketId)).toHaveLength(2);
    expect(discord.calls.some(call => call.method === "POST" && call.path === `/channels/${ticketId}/messages`)).toBe(false);
  });
});

function welcomeComponents(discord: ReturnType<typeof fakeDiscord>) {
  return discord.messages.get(ticketId)![0].components as Array<{ type: number; id?: number; components: Array<Record<string, unknown>> }>;
}
function makeLegacyButtons(discord: ReturnType<typeof fakeDiscord>) {
  welcomeComponents(discord)[0].components.splice(1);
}
function addDiscordComponentDefaults(discord: ReturnType<typeof fakeDiscord>) {
  for (const [index, row] of welcomeComponents(discord).entries()) {
    row.id = index + 1;
    for (const [buttonIndex, button] of row.components.entries()) {
      button.id = buttonIndex + 2;
      button.disabled ??= false;
      if (button.emoji && typeof button.emoji === "object") Object.assign(button.emoji, { id: null, animated: false });
    }
  }
}

describe("recuperação durável dos botões de venda", () => {
  it("repara os botões antigos de um ticket aberto e não repete o PATCH quando Discord adiciona IDs e defaults", async () => {
    const discord = fakeDiscord();
    await completeItemSellingInteraction(raw(), { ...discord, settings });
    makeLegacyButtons(discord);
    discord.calls.length = 0;
    expect(await reconcileCompletedGwStoreItemSellingTickets({ ...discord, now: () => completedAt })).toEqual({ scanned: 1, active: 1, completed: 0, alreadyClosed: 0, failed: 0 });
    expect(welcomeComponents(discord)[0].components).toHaveLength(2);
    const update = discord.calls.find(call => call.method === "PATCH");
    expect(update?.body).toMatchObject({ allowed_mentions: { parse: [] } });
    expect(update?.body).not.toHaveProperty("content");
    expect(update?.body).not.toHaveProperty("embeds");
    addDiscordComponentDefaults(discord);
    discord.calls.length = 0;
    expect(await reconcileCompletedGwStoreItemSellingTickets({ ...discord, now: () => completedAt + 180_000 })).toMatchObject({ active: 1, failed: 0 });
    expect(discord.calls.some(call => call.method === "PATCH" || call.method === "POST" || call.method === "DELETE")).toBe(false);
  });

  it("repara concluídos dentro do prazo, mas não faz PATCH de botões quando já deve fechar", async () => {
    const discord = fakeDiscord();
    await completedTicket(discord);
    makeLegacyButtons(discord);
    expect(await reconcileCompletedGwStoreItemSellingTickets({ ...discord, now: () => completedAt + 180_000 })).toMatchObject({ active: 1, failed: 0 });
    expect(welcomeComponents(discord)[0].components).toHaveLength(2);
    expect(welcomeComponents(discord)[0].components[0].disabled).toBe(true);
    makeLegacyButtons(discord);
    discord.calls.length = 0;
    expect(await reconcileCompletedGwStoreItemSellingTickets({ ...discord, now: () => completedAt + 300_000 })).toMatchObject({ completed: 1, failed: 0 });
    expect(discord.calls.some(call => call.method === "PATCH")).toBe(false);
  });

  it("recupera no próximo ciclo após429 ao atualizar um aberto, sem apagá-lo nem reenviar mensagens", async () => {
    const discord = fakeDiscord();
    await completeItemSellingInteraction(raw(), { ...discord, settings });
    makeLegacyButtons(discord);
    const welcome = discord.messages.get(ticketId)![0];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith(`/channels/${ticketId}/messages/${welcome.id}`) && init?.method === "PATCH") return Response.json({ code: 20028 }, { status: 429 });
      return discord.fetcher(url, init);
    }) as typeof fetch;
    vi.spyOn(console, "error").mockImplementation(() => {});
    discord.calls.length = 0;
    expect(await reconcileCompletedGwStoreItemSellingTickets({ fetcher, now: () => completedAt })).toMatchObject({ failed: 1, completed: 0 });
    expect(welcomeComponents(discord)[0].components).toHaveLength(1);
    expect(await reconcileCompletedGwStoreItemSellingTickets({ ...discord, now: () => completedAt + 180_000 })).toMatchObject({ active: 1, failed: 0, completed: 0 });
    expect(welcomeComponents(discord)[0].components).toHaveLength(2);
    expect(discord.calls.some(call => call.method === "POST" || call.method === "DELETE")).toBe(false);
    expect(discord.messages.get(ticketId)).toHaveLength(1);
  });

  it("o sync também evita PATCH de botões que já estão corretos", async () => {
    const discord = fakeDiscord();
    await completeItemSellingInteraction(raw(), { ...discord, settings });
    addDiscordComponentDefaults(discord);
    const welcome = discord.messages.get(ticketId)![0];
    discord.calls.length = 0;
    expect(await synchronizeGwStoreItemSelling(discord)).toMatchObject({ ticketsScanned: 1, ticketsUpdated: 1, ticketsFailed: 0 });
    expect(discord.calls.some(call => call.method === "PATCH" && call.path === `/channels/${ticketId}/messages/${welcome.id}`)).toBe(false);
    expect(discord.calls.some(call => call.method === "DELETE")).toBe(false);
    expect(discord.messages.get(ticketId)).toHaveLength(1);
  });
});
