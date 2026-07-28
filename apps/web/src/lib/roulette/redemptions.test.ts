import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { rpc, from, maybeSingle, ensureRouletteRedemptionTicket } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  return {
    rpc: vi.fn(),
    maybeSingle,
    from: vi.fn(() => ({ select })),
    ensureRouletteRedemptionTicket: vi.fn(),
  };
});
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc, from }),
}));
vi.mock("./discord", () => ({ ensureRouletteRedemptionTicket }));

import { syncRouletteRedemptionTicketControls } from "./redemptions";

const REDEMPTION_ID = "9b000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  maybeSingle.mockResolvedValue({
    data: {
      id: REDEMPTION_ID,
      discord_user_id: "900000000000000013",
      total_value_cents: 100,
      discord_ticket_channel_id: "900000000000000020",
      guilds: { discord_guild_id: "900000000000000010" },
      roulette_redemption_items: [{ product_name: "Bamboo Seed", quantity: 1 }],
    },
    error: null,
  });
  rpc.mockResolvedValue({ data: null, error: null });
});

afterEach(() => vi.clearAllMocks());

describe("atualizar os botões de um ticket já aberto", () => {
  it("passa o canal guardado e proíbe criar outro", async () => {
    ensureRouletteRedemptionTicket.mockResolvedValue({
      synchronized: true,
      channelId: "900000000000000020",
      created: false,
    });

    await syncRouletteRedemptionTicketControls(REDEMPTION_ID);

    expect(ensureRouletteRedemptionTicket).toHaveBeenCalledWith(
      expect.objectContaining({ redemptionId: REDEMPTION_ID }),
      { existingChannelId: "900000000000000020", refuseCreate: true },
    );
  });

  it("marca o ticket como falho quando o canal sumiu, para liberar o reabrir", async () => {
    // Sem isso o resgate fica num beco: o painel só oferece um refresh que
    // nunca vai funcionar, e o prêmio fica preso em "aguardando entrega".
    ensureRouletteRedemptionTicket.mockResolvedValue({
      synchronized: false,
      reason: "channel-gone",
    });

    const result = await syncRouletteRedemptionTicketControls(REDEMPTION_ID);

    expect(result).toEqual({ synchronized: false, reason: "channel-gone" });
    expect(rpc).toHaveBeenCalledWith("fail_roulette_redemption_ticket", {
      p_redemption_id: REDEMPTION_ID,
      p_error: "O canal do ticket não existe mais no Discord.",
    });
  });

  it("não mexe no ticket quando só a mensagem inicial sumiu", async () => {
    // O canal continua vivo; derrubar o status aqui perderia um ticket bom.
    ensureRouletteRedemptionTicket.mockResolvedValue({
      synchronized: false,
      reason: "welcome-missing",
    });

    await syncRouletteRedemptionTicketControls(REDEMPTION_ID);

    expect(rpc).not.toHaveBeenCalled();
  });
});
