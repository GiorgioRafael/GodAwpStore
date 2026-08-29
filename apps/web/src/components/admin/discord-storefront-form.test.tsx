import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiscordStorefrontForm } from "./discord-storefront-form";

const actionMocks = vi.hoisted(() => ({
  publishDiscordStorefrontAction: vi.fn(async () => ({
    ok: true,
    message: "Vitrine publicada.",
  })),
}));

vi.mock("@/app/actions/admin", () => actionMocks);

const firstGame = {
  id: "a5b82d6f-a324-47fa-a861-a046559e3a11",
  name: "Mundo 1",
  gameId: "d5b82d6f-a324-47fa-a861-a046559e3a11",
  gameName: "Grow a Garden 2",
  categoryCount: 4,
  productCount: 20,
};
const secondGame = {
  id: "b5b82d6f-a324-47fa-a861-a046559e3a11",
  name: "Mundo 2",
  gameId: "d5b82d6f-a324-47fa-a861-a046559e3a11",
  gameName: "Grow a Garden 2",
  categoryCount: 1,
  productCount: 3,
};
const channels = [
  {
    id: "223456789012345678",
    name: "comprar-gag2",
    type: 0 as const,
    position: 1,
    parentId: null,
    categoryName: "COMPRAR",
  },
  {
    id: "323456789012345678",
    name: "comprar-script",
    type: 0 as const,
    position: 2,
    parentId: null,
    categoryName: "COMPRAR",
  },
];

afterEach(() => cleanup());

describe("configuração de vitrines do Discord", () => {
  it("explica a separação e permite configurar um canal diferente para cada jogo", async () => {
    const user = userEvent.setup();
    render(
      <DiscordStorefrontForm
        games={[firstGame, secondGame]}
        guilds={[
          {
            id: "c5b82d6f-a324-47fa-a861-a046559e3a11",
            discordGuildId: "123456789012345678",
            name: "THstore",
            channels,
            current: [
              {
                game_id: firstGame.gameId,
                game_name: firstGame.gameName,
                catalog_store_id: firstGame.id,
                catalog_store_name: firstGame.name,
                channel_id: channels[0].id,
                channel_name: channels[0].name,
                message_ids: ["423456789012345678"],
                published_at: "2026-07-27T12:00:00.000Z",
              },
            ],
            boosterDiscount: {
              enabled: true,
              discount_bps: 500,
              minimum_subtotal_cents: 5_000,
            },
            channelLoadError: null,
          },
        ]}
      />,
    );

    expect(
      screen.getByText(/Cada uma fica no seu próprio canal/i),
    ).toBeInTheDocument();
    expect(screen.getByText(firstGame.name)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "1. Loja/mundo desta vitrine" })).toHaveValue(
      secondGame.id,
    );
    expect(screen.getByText(/3 produtos de 1 categoria/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Produtos de outras lojas não aparecerão neste canal/i),
    ).toBeInTheDocument();

    const channelSelect = screen.getByRole("combobox", { name: "2. Canal da vitrine" });
    expect(channelSelect).toHaveValue(channels[1].id);
    expect(screen.getByRole("option", { name: "COMPRAR / #comprar-gag2 · usado por Mundo 1" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "COMPRAR / #comprar-script" })).toBeInTheDocument();
    await user.selectOptions(channelSelect, channels[0].id);
    expect(channelSelect).toHaveValue(channels[0].id);
    expect(screen.getByRole("button", { name: "Publicar nova vitrine" })).toBeEnabled();
  });

  it("avisa que a vitrine antiga precisa ser ligada a um jogo", () => {
    render(
      <DiscordStorefrontForm
        games={[firstGame]}
        guilds={[
          {
            id: "c5b82d6f-a324-47fa-a861-a046559e3a11",
            discordGuildId: "123456789012345678",
            name: "GWStore",
            channels,
            current: [
              {
                game_id: null,
                game_name: "Catálogo completo",
                channel_id: channels[0].id,
                channel_name: channels[0].name,
                message_ids: ["423456789012345678"],
                published_at: "2026-07-27T12:00:00.000Z",
              },
            ],
            boosterDiscount: {
              enabled: true,
              discount_bps: 500,
              minimum_subtotal_cents: 5_000,
            },
            channelLoadError: null,
          },
        ]}
      />,
    );

    expect(
      screen.getByText(/Escolha um jogo para separar os produtos desta vitrine/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Atualizar vitrine" })).toBeEnabled();
  });

  it("oferece a vitrine única para o comprador escolher a loja antes dos itens", async () => {
    const user = userEvent.setup();
    render(
      <DiscordStorefrontForm
        games={[firstGame, secondGame]}
        guilds={[{
          id: "c5b82d6f-a324-47fa-a861-a046559e3a11",
          discordGuildId: "123456789012345678",
          name: "GWStore",
          channels,
          current: [],
          integrated: null,
          boosterDiscount: { enabled: true, discount_bps: 500, minimum_subtotal_cents: 5_000 },
          channelLoadError: null,
        }]}
      />,
    );

    await user.click(screen.getByRole("radio", { name: /Uma vitrine com todas as lojas/i }));

    expect(screen.getByText(/O comprador verá 2 lojas para escolher/i)).toBeInTheDocument();
    expect(screen.getByText(/itens da loja selecionada aparecem apenas para o comprador/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publicar vitrine única" })).toBeEnabled();
  });
});
