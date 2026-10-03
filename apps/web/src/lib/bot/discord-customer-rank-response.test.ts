import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { completeDiscordCustomerRankResponse, isNativeDiscordCustomerRankButton } from "./discord-bot";
import type { CustomerRankRoleRepository } from "./discord-customer-rank";
import { CUSTOMER_RANK_BUTTON_CUSTOM_ID } from "./customer-top-spenders";
import { DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION } from "./booster-discount";

const applicationId = "123456789012345678";
const buyerId = "223456789012345678";
const otherBuyerId = "323456789012345678";
const guildId = "423456789012345678";
const raw = {
  type: 3, application_id: applicationId, token: "interaction-token-for-test-123456",
  guild_id: guildId, member: { user: { id: buyerId } },
  user: { id: otherBuyerId },
  data: { component_type: 2, custom_id: CUSTOMER_RANK_BUTTON_CUSTOM_ID, buyer_id: otherBuyerId },
};
const progress = {
  guildId: "guild-row", buyerDiscordId: buyerId, totalSpentCents: 8000,
  currentRank: null, nextRank: null, amountToNextRankCents: 0,
};

function dependencies() {
  const repository: CustomerRankRoleRepository = {
    getProgress: vi.fn().mockResolvedValue(progress),
    findGuildId: vi.fn(), listLevels: vi.fn(), listRoleBindings: vi.fn(),
    saveRoleBinding: vi.fn(), claimRoleSync: vi.fn(), releaseRoleSync: vi.fn(),
  };
  return {
    repository,
    fetchGuildIdentity: vi.fn(async () => ({ discordGuildId: guildId, ownerDiscordId: otherBuyerId, name: "GWStore" })),
    registerGuild: vi.fn(async () => ({ id: "guild-row", whitelistEntryId: null,
      boosterDiscount: DEFAULT_BOOSTER_DISCOUNT_CONFIGURATION })),
    synchronizeRole: vi.fn(async () => progress),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("consulta privada do botão Ver meu rank", () => {
  it("reconhece somente o botão de consulta pessoal", () => {
    expect(isNativeDiscordCustomerRankButton(raw)).toBe(true);
    expect(isNativeDiscordCustomerRankButton({ ...raw, type: 2 })).toBe(false);
    expect(isNativeDiscordCustomerRankButton({ ...raw, data: { ...raw.data, custom_id: `${CUSTOMER_RANK_BUTTON_CUSTOM_ID}:${otherBuyerId}` } })).toBe(false);
  });

  it("consulta quem clicou e atualiza apenas a resposta privada da interação", async () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", applicationId);
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const deps = dependencies();
    await completeDiscordCustomerRankResponse(raw, deps);
    expect(deps.repository.getProgress).toHaveBeenCalledWith("guild-row", buyerId);
    expect(deps.synchronizeRole).toHaveBeenCalledWith(expect.objectContaining({ buyerDiscordId: buyerId, progress }), deps.repository);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain(`/webhooks/${applicationId}/${raw.token}/messages/@original`);
    expect(init?.method).toBe("PATCH");
    expect(String(init?.body)).toContain("SEU RANKING");
    expect(String(init?.body)).toContain("80,00");
    expect(String(url)).not.toContain("/channels/");
  });

  it("mantém o erro privado quando a consulta falha", async () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", applicationId);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const deps = dependencies();
    vi.mocked(deps.repository.getProgress).mockRejectedValue(new Error("database secret"));
    await completeDiscordCustomerRankResponse(raw, deps);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0]![0])).toContain("/messages/@original");
    expect(String(fetcher.mock.calls[0]![1]?.body)).toContain("RANKING INDISPONÍVEL");
    expect(String(fetcher.mock.calls[0]![1]?.body)).not.toContain("database secret");
    expect(deps.synchronizeRole).not.toHaveBeenCalled();
  });
});
