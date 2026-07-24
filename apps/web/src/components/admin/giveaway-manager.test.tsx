import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  createGiveawayAction: vi.fn(async () => ({ ok: true, message: "Criado." })),
  cancelGiveawayAction: vi.fn(async () => ({ ok: true, message: "Cancelado." })),
  republishGiveawayAction: vi.fn(async () => ({ ok: true, message: "Publicado." })),
  rerollGiveawayWinnersAction: vi.fn(async () => ({ ok: true, message: "Resorteado." })),
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

    expect(screen.queryByLabelText("Início")).toBeNull();
    expect((screen.getByLabelText("Encerramento") as HTMLInputElement).value)
      .toBe("2026-07-22T12:00");
    expect(screen.getByText("Começa ao publicar · horário de Brasília")).toBeTruthy();
    expect(screen.getByText(
      "O sorteio começa assim que for criado e o pacote é reservado na mesma operação.",
    )).toBeTruthy();
    expect(screen.getByLabelText("Indicações válidas")).toBeTruthy();
    expect(screen.getByLabelText("Observações adicionais")).toBeTruthy();
    expect(screen.getByText(/usuário cria um convite nativo pelo próprio Discord/))
      .toBeTruthy();
  });

  it("permite selecionar exatamente quantos ganhadores serão resorteados", () => {
    render(<GiveawayManager
      guilds={[]}
      products={[]}
      giveaways={[{
        id: "11111111-1111-4111-8111-111111111111",
        publicSlug: "abc123",
        title: "Sorteio",
        guildName: "GWStore",
        status: "completed",
        startsAt: "2026-07-20T18:00:00.000Z",
        endsAt: "2026-07-21T18:00:00.000Z",
        requiredValidInvites: 1,
        participantCount: 20,
        eligibleParticipantCount: 12,
        publicationChannelName: "sorteios",
        publicationError: null,
        winnerDisplayName: "Primeiro",
        winnerDiscordUserId: "223456789012345678",
        winners: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            position: 1,
            displayName: "Primeiro",
            discordUserId: "223456789012345678",
            ticketStatus: "open",
            ticketChannelId: "423456789012345678",
            ticketError: null,
          },
          {
            id: "33333333-3333-4333-8333-333333333333",
            position: 2,
            displayName: "Segundo",
            discordUserId: "323456789012345678",
            ticketStatus: "open",
            ticketChannelId: "523456789012345678",
            ticketError: null,
          },
        ],
        discordTicketStatus: "open",
        discordTicketChannelId: "423456789012345678",
        failureReason: null,
        prizes: [{
          productId: "44444444-4444-4444-8444-444444444444",
          productName: "Star Fruit",
          quantity: 2,
        }],
      }]}
      defaultEndsAt="2026-07-22T12:00"
    />);

    expect(screen.getByText("Resortear quem não apareceu")).toBeTruthy();
    expect((screen.getByLabelText("1. Primeiro") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("2. Segundo") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: "Resortear" }) as HTMLButtonElement).disabled)
      .toBe(true);
  });
});
