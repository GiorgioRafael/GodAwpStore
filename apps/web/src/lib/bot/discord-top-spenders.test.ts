import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const brand = vi.hoisted(() => ({ IS_GWSTORE: true }));
vi.mock("@/lib/brand", () => brand);
import { synchronizeGwStoreTopSpenders } from "./discord-top-spenders";
import { GWSTORE_RANKING_CHANNEL_ID as channelId, GWSTORE_RANKING_GUILD_ID as guildId,
  topSpendersMessage } from "./customer-top-spenders";
import type { TopSpendersRepository } from "./customer-top-spenders-repository";

const botId = "123456789012345678";
const messageId = "223456789012345678";
const noticeId = "323456789012345678";
const buyerId = "423456789012345678";
const leaders = [{ buyerDiscordId: buyerId, totalSpentCents: 1200 }];
const message = (pinned = true) => ({ id: messageId, author: { id: botId }, channel_id: channelId,
  type: 0, pinned, embeds: topSpendersMessage(leaders).embeds,
  components: topSpendersMessage(leaders).components });

function repository(savedId: string | null = messageId): TopSpendersRepository {
  return {
    findGuild: vi.fn().mockResolvedValue({ id: "gw", updated_at: "now", configuration:
      { customer_top_spenders_message_id: savedId } }),
    listPaidPurchases: vi.fn().mockResolvedValue([{ source: "product", id: "order", guildId: "gw",
      buyerDiscordId: buyerId, amountCents: 1200, paidAt: "2026-10-01T00:00:00Z" }]),
    claim: vi.fn().mockResolvedValue(true), release: vi.fn().mockResolvedValue(undefined),
    saveMessage: vi.fn().mockResolvedValue(undefined),
  };
}

function discord(options: { savedStatus?: number; existing?: boolean; pinned?: boolean;
  wrongGuild?: boolean; foreignAuthor?: boolean; failedPatch?: boolean; notice?: boolean;
  profileName?: string } = {}) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/users/@me")) return Response.json({ id: botId, bot: true });
    if (url.includes("/users/")) return options.profileName
      ? Response.json({ id: url.split("/").at(-1), global_name: options.profileName, username: "customer" })
      : new Response(null, { status: 404 });
    if (url.endsWith(`/channels/${channelId}`)) return Response.json({ guild_id: options.wrongGuild ? "other" : guildId, type: 0 });
    if (url.endsWith(`/messages/${messageId}`) && method === "GET") {
      if (options.savedStatus) return Response.json({ code: options.savedStatus === 404 ? 10008 : 50013 }, { status: options.savedStatus });
      return Response.json({ ...message(options.pinned), author: { id: options.foreignAuthor ? "other" : botId },
        embeds: options.failedPatch ? [{ title: topSpendersMessage(leaders).embeds[0].title }] : message().embeds });
    }
    if (url.includes("/messages?limit=100")) return Response.json([
      ...(options.existing ? [message(options.pinned)] : []),
      ...(options.notice ? [{ id: noticeId, author: { id: botId }, type: 6, message_reference: { message_id: messageId } }] : []),
    ]);
    if (url.endsWith("/messages") && method === "POST") return Response.json(message(false));
    if (url.endsWith(`/messages/${messageId}`) && method === "PATCH") {
      return options.failedPatch ? new Response("Forbidden", { status: 403 }) : Response.json(message());
    }
    if (url.endsWith(`/messages/pins/${messageId}`) && method === "PUT") return new Response(null, { status: 204 });
    if (url.endsWith(`/messages/${noticeId}`) && method === "DELETE") return new Response(null, { status: 204 });
    throw new Error(`Unexpected Discord call: ${method} ${url}`);
  });
}

beforeEach(() => {
  brand.IS_GWSTORE = true;
  vi.stubEnv("DISCORD_APPLICATION_ID", botId);
  vi.stubEnv("DISCORD_BOT_TOKEN", "test-token");
});
afterEach(() => vi.unstubAllEnvs());

describe("mensagem fixa do Top 5", () => {
  it("cria uma única mensagem, salva o ID e fixa; remove apenas o aviso de fixação do bot", async () => {
    const repo = repository(null), fetcher = discord({ notice: true });
    await expect(synchronizeGwStoreTopSpenders({ repository: repo, fetcher })).resolves.toMatchObject({ status: "updated", customers: 1 });
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]![1]!.body))).toMatchObject({ enforce_nonce: true, allowed_mentions: { parse: [] } });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
    expect(repo.saveMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "gw" }), messageId);
    expect(repo.release).toHaveBeenCalledWith("gw", expect.any(String), true);
  });

  it("reutiliza a mensagem já fixada e não publica outro post quando o ranking não mudou", async () => {
    const fetcher = discord();
    await synchronizeGwStoreTopSpenders({ repository: repository(), fetcher });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method)).toHaveLength(0);
  });

  it("restaura o botão no mesmo post mesmo quando o Top 5 não muda", async () => {
    const base = discord();
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const response = await base(input, init);
      if (String(input).endsWith(`/messages/${messageId}`) && !init?.method) {
        return Response.json({ ...await response.json(), components: [] });
      }
      return response;
    });
    await synchronizeGwStoreTopSpenders({ repository: repository(), fetcher });
    const patch = fetcher.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(String(patch![0])).toContain(`/messages/${messageId}`);
    expect(JSON.parse(String(patch![1]?.body)).components[0].components[0]).toMatchObject({
      label: "Ver meu rank", custom_id: "gwstore_rank:self",
    });
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("recupera a publicação que não foi salva no banco sem duplicá-la", async () => {
    const repo = repository(null), fetcher = discord({ existing: true });
    await synchronizeGwStoreTopSpenders({ repository: repo, fetcher });
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(repo.saveMessage).toHaveBeenCalledOnce();
  });

  it("edita o mesmo post quando outro comprador entra no Top 5", async () => {
    const repo = repository(), fetcher = discord();
    vi.mocked(repo.listPaidPurchases).mockResolvedValue([{ source: "robux", id: "new-order", guildId: "gw",
      buyerDiscordId: noticeId, amountCents: 5000, paidAt: "2026-10-01T00:00:00Z" }]);
    await synchronizeGwStoreTopSpenders({ repository: repo, fetcher });
    const patches = fetcher.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(String(patches[0]![0])).toContain(`/messages/${messageId}`);
    expect(JSON.parse(String(patches[0]![1]!.body)).embeds[0].description).toContain(`<@${noticeId}>`);
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("exibe o nome público inclusive de compradores que saíram do servidor", async () => {
    const fetcher = discord({ profileName: "Cliente antigo" });
    await synchronizeGwStoreTopSpenders({ repository: repository(), fetcher });
    const patch = fetcher.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patch![1]!.body)).embeds[0].description).toContain("1º lugar** · Cliente antigo");
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("recupera uma mensagem apagada e impede duplicação quando a resposta é 403", async () => {
    const replacement = discord({ savedStatus: 404 });
    await synchronizeGwStoreTopSpenders({ repository: repository(), fetcher: replacement });
    expect(replacement.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    const denied = discord({ savedStatus: 403 });
    await expect(synchronizeGwStoreTopSpenders({ repository: repository(), fetcher: denied })).rejects.toThrow();
    expect(denied.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it.each([{ wrongGuild: true }, { foreignAuthor: true }, { failedPatch: true }])(
    "falha sem publicar uma substituição em caso de erro: %j", async (options) => {
      const repo = repository(), fetcher = discord(options);
      await expect(synchronizeGwStoreTopSpenders({ repository: repo, fetcher })).rejects.toThrow();
      expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
      expect(repo.release).toHaveBeenCalledWith("gw", expect.any(String), false);
    },
  );

  it("não faz operações na THStore ou enquanto outro worker possui a reserva", async () => {
    const repo = repository(), fetcher = discord();
    brand.IS_GWSTORE = false;
    await expect(synchronizeGwStoreTopSpenders({ repository: repo, fetcher })).resolves.toEqual({ status: "disabled" });
    expect(repo.findGuild).not.toHaveBeenCalled();
    brand.IS_GWSTORE = true;
    vi.mocked(repo.claim).mockResolvedValue(false);
    await expect(synchronizeGwStoreTopSpenders({ repository: repo, fetcher })).resolves.toEqual({ status: "busy" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
