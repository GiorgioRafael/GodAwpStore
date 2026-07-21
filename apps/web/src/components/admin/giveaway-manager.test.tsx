import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  createGiveawayAction: vi.fn(async () => ({ ok: true, message: "Criado." })),
  cancelGiveawayAction: vi.fn(async () => ({ ok: true, message: "Cancelado." })),
  republishGiveawayAction: vi.fn(async () => ({ ok: true, message: "Publicado." })),
}));

vi.mock("@/app/actions/giveaways", () => actionMocks);

import { GiveawayManager } from "./giveaway-manager";

beforeAll(() => {
  if (!globalThis.crypto.randomUUID) {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: () => "11111111-1111-4111-8111-111111111111",
    });
  }
});

describe("GiveawayManager", () => {
  it("mostra apenas o encerramento e deixa claro que o sorteio começa ao criar", () => {
    render(<GiveawayManager
      guilds={[{
        id: "11111111-1111-4111-8111-111111111111",
        name: "GWStore",
        discordGuildId: "123456789012345678",
        channels: [{ id: "223456789012345678", name: "sorteios", categoryName: null }],
        categories: [],
        error: null,
      }]}
      products={[{
        id: "22222222-2222-4222-8222-222222222222",
        name: "Super Watering",
        stockQuantity: 10,
        group: "Grow a Garden",
      }]}
      giveaways={[]}
      defaultEndsAt="2026-07-22T12:00"
    />);

    expect(screen.queryByLabelText("Início")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Encerramento")).toHaveValue("2026-07-22T12:00");
    expect(screen.getByText("Começa ao publicar · horário de Brasília")).toBeVisible();
    expect(screen.getByText(
      "O sorteio começa assim que for criado e o pacote é reservado na mesma operação.",
    )).toBeVisible();
  });
});
