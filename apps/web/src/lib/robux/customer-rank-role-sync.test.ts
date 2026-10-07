import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { DiscordApiError } from "@/lib/bot/discord-api";
import { synchronizeDiscordCustomerRankRole, type CustomerRankRoleRepository } from "@/lib/bot/discord-customer-rank";
import type { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { reconcileRobuxCustomerRankRoles, synchronizeRobuxCustomerRankRole } from "./customer-rank-role-sync";

type Client = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;
const input = { guildId: "guild-row", discordGuildId: "123456789012345678", buyerDiscordId: "223456789012345678" };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("reconciliação dos cargos de compradores de Robux", () => {
  it("encerra a pendência de quem saiu sem alterar pagamento ou histórico", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "discord-token-for-test");
    const botId = "323456789012345678";
    vi.stubEnv("DISCORD_APPLICATION_ID", botId);
    const progress = { ...input, totalSpentCents: 400, currentRank: null, nextRank: null, amountToNextRankCents: 100 };
    const repository: CustomerRankRoleRepository = {
      findGuildId: vi.fn(async () => input.guildId),
      getProgress: vi.fn(async () => progress),
      listLevels: vi.fn(async () => []),
      listRoleBindings: vi.fn(async () => []),
      saveRoleBinding: vi.fn(async () => undefined),
      claimRoleSync: vi.fn(async () => true),
      releaseRoleSync: vi.fn(async () => undefined),
    };
    const fetcher = vi.fn<typeof fetch>(async (url) => String(url).endsWith("/users/@me")
      ? Response.json({ id: botId, bot: true })
      : Response.json({ code: 10007 }, { status: 404 }));
    const synchronize: typeof synchronizeDiscordCustomerRankRole = (candidate) =>
      synchronizeDiscordCustomerRankRole(candidate, repository, fetcher);
    const { client, query } = queryClient();

    await synchronizeRobuxCustomerRankRole(input, client, synchronize);

    expect(query.update).toHaveBeenCalledWith({ customer_rank_role_synced_at: expect.any(String) });
    expect(query.eq).toHaveBeenCalledWith("guild_id", input.guildId);
    expect(query.eq).toHaveBeenCalledWith("buyer_discord_id", input.buyerDiscordId);
    expect(query.eq).toHaveBeenCalledWith("payment_status", "paid");
    expect(query.eq).toHaveBeenCalledWith("status", "paid");
    expect(query.is).toHaveBeenCalledWith("customer_rank_role_synced_at", null);
    expect(query.lte).toHaveBeenCalledWith("paid_at", expect.any(String));
    expect(repository.claimRoleSync).not.toHaveBeenCalled();
  });

  it("mantém pendente um erro de cargo excluído para a próxima tentativa", async () => {
    const { client, query } = queryClient();
    const synchronize = vi.fn<typeof synchronizeDiscordCustomerRankRole>(async () => {
      throw new DiscordApiError(404, `/guilds/${input.discordGuildId}/roles`, "GET", 10011);
    });

    await expect(synchronizeRobuxCustomerRankRole(input, client, synchronize)).rejects.toMatchObject({ discordCode: 10011 });
    expect(query.update).not.toHaveBeenCalled();
  });

  it("registra rota e código de falhas reais para diagnóstico", async () => {
    const order = { id: "order-row", guild_id: input.guildId, buyer_discord_id: input.buyerDiscordId,
      guilds: { discord_guild_id: input.discordGuildId } };
    const { client, query } = queryClient([order]);
    const path = `/guilds/${input.discordGuildId}/roles`;
    const synchronize = vi.fn<typeof synchronizeRobuxCustomerRankRole>(async () => {
      throw new DiscordApiError(404, path, "GET", 10004);
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await reconcileRobuxCustomerRankRoles(client, synchronize)).toEqual({ checked: 1, synced: 0, failed: 1 });
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`GET ${path}; código=10004`));
    expect(query.update).toHaveBeenCalledTimes(1);
    expect(query.update).toHaveBeenCalledWith({ customer_rank_role_sync_attempted_at: expect.any(String) });
  });
});

function queryClient(data: unknown[] | null = null) {
  const query = {
    select: vi.fn(), update: vi.fn(), eq: vi.fn(), is: vi.fn(), lte: vi.fn(), or: vi.fn(), order: vi.fn(), limit: vi.fn(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
  };
  for (const method of [query.select, query.update, query.eq, query.is, query.lte, query.or, query.order, query.limit]) {
    method.mockReturnValue(query);
  }
  return { client: { from: vi.fn(() => query) } as unknown as Client, query };
}
