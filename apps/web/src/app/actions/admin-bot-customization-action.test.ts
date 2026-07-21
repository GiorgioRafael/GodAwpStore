import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BOT_MESSAGE_CUSTOMIZATION } from "@/lib/bot/message-customization";
import { DEFAULT_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS } from "@/lib/bot/ticket-close-admins";
import { DEFAULT_TICKET_NOTIFICATION_DISCORD_USER_IDS } from "@/lib/bot/ticket-notifications";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
  synchronizePublishedDiscordStorefronts: vi.fn(),
  synchronizeDiscordProductEmojis: vi.fn(),
  synchronizeAllOpenDiscordTicketControls: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}));
vi.mock("@/lib/bot/discord-storefront-sync", () => ({
  synchronizePublishedDiscordStorefronts: mocks.synchronizePublishedDiscordStorefronts,
}));
vi.mock("@/lib/bot/discord-product-emojis", () => ({
  synchronizeDiscordProductEmojis: mocks.synchronizeDiscordProductEmojis,
}));
vi.mock("@/lib/bot/discord-ticket-controls-sync", () => ({
  synchronizeAllOpenDiscordTicketControls: mocks.synchronizeAllOpenDiscordTicketControls,
}));
vi.mock("@/lib/bot/discord-storefront", () => ({
  listDiscordTextChannels: vi.fn(),
  publishDiscordStorefront: vi.fn(),
  readStorefrontConfiguration: vi.fn(),
  withStorefrontConfiguration: vi.fn(),
}));
vi.mock("@/lib/bot/booster-discount", () => ({
  withBoosterDiscountConfiguration: vi.fn(),
}));
vi.mock("@/lib/bot/commerce-service", () => ({
  BotCommerceService: class {},
}));
vi.mock("@/lib/bot/supabase-repository", () => ({
  SupabaseBotCommerceRepository: class {},
}));
vi.mock("@/lib/bot/message-customization-server", () => ({
  loadBotMessageCustomization: vi.fn(),
}));

import {
  saveBotMessageCustomizationAction,
  saveProductOrderAction,
  type AdminActionState,
} from "./admin";

const previousState: AdminActionState = { ok: false, message: "" };
const updatedAt = "2026-07-17T12:00:00.000Z";

describe("action de personalização do bot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({
      authUserId: "10000000-0000-4000-8000-000000000001",
    });
    mocks.synchronizePublishedDiscordStorefronts.mockResolvedValue({
      published: 1,
      failed: 0,
      productEmojiFailures: 0,
    });
    mocks.synchronizeDiscordProductEmojis.mockResolvedValue({ failed: 0 });
    mocks.synchronizeAllOpenDiscordTicketControls.mockResolvedValue({
      processed: 2,
      synchronized: 2,
      missingChannelsClosed: 0,
      failed: 0,
      permissionsUpdated: 2,
      welcomeMessagesUpdated: 2,
    });
  });

  it("rejeita configuração desconhecida antes de autenticar ou gravar", async () => {
    const formData = customizationForm({
      ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
      unknown: true,
    });

    const result = await saveBotMessageCustomizationAction(previousState, formData);

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Revise os campos/);
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
    expect(mocks.synchronizePublishedDiscordStorefronts).not.toHaveBeenCalled();
  });

  it("rejeita lista de notificações inválida antes de autenticar ou gravar", async () => {
    const formData = customizationForm(DEFAULT_BOT_MESSAGE_CUSTOMIZATION, ["discord-inválido"]);

    const result = await saveBotMessageCustomizationAction(previousState, formData);

    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.notificationDiscordUserIds).toBeDefined();
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
    expect(mocks.synchronizePublishedDiscordStorefronts).not.toHaveBeenCalled();
  });

  it.each([
    [
      "duplicada",
      ["385924725332901909", "385924725332901909"],
    ],
    [
      "acima do limite",
      Array.from({ length: 26 }, (_, index) => `3${String(index).padStart(17, "0")}`),
    ],
  ])("rejeita lista de notificações %s", async (_label, notificationDiscordUserIds) => {
    const result = await saveBotMessageCustomizationAction(
      previousState,
      customizationForm(DEFAULT_BOT_MESSAGE_CUSTOMIZATION, notificationDiscordUserIds),
    );

    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.notificationDiscordUserIds).toBeDefined();
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
  });

  it.each([
    ["inválida", ["discord-inválido"]],
    ["duplicada", ["234486394414825472", "234486394414825472"]],
    [
      "acima do limite",
      Array.from({ length: 26 }, (_, index) => `6${String(index).padStart(17, "0")}`),
    ],
  ])(
    "rejeita lista de administradores de fechamento %s antes de autenticar",
    async (_label, ticketCloseAdminDiscordUserIds) => {
      const result = await saveBotMessageCustomizationAction(
        previousState,
        customizationForm(
          DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
          DEFAULT_TICKET_NOTIFICATION_DISCORD_USER_IDS,
          ticketCloseAdminDiscordUserIds,
        ),
      );

      expect(result.ok).toBe(false);
      expect(result.fieldErrors?.ticketCloseAdminDiscordUserIds).toBeDefined();
      expect(mocks.requireAdmin).not.toHaveBeenCalled();
    },
  );

  it("salva com trava otimista, identifica o admin e atualiza as vitrines", async () => {
    const client = clientMock({ id: 1 });
    mocks.createServerSupabaseClient.mockResolvedValue(client);

    const result = await saveBotMessageCustomizationAction(
      previousState,
      customizationForm(DEFAULT_BOT_MESSAGE_CUSTOMIZATION),
    );

    expect(result).toEqual({
      ok: true,
      message: "Personalização salva e vitrines publicadas atualizadas.",
    });
    expect(client.update).toHaveBeenCalledWith(
      expect.objectContaining({
        bot_message_config: DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
        ticket_notification_discord_user_ids: DEFAULT_TICKET_NOTIFICATION_DISCORD_USER_IDS,
        ticket_close_admin_discord_user_ids: DEFAULT_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS,
        updated_by: "10000000-0000-4000-8000-000000000001",
      }),
    );
    expect(client.eq).toHaveBeenNthCalledWith(1, "id", 1);
    expect(client.eq).toHaveBeenNthCalledWith(2, "updated_at", updatedAt);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/customizacao-bot");
    expect(mocks.synchronizePublishedDiscordStorefronts).toHaveBeenCalledOnce();
    expect(mocks.synchronizeAllOpenDiscordTicketControls).toHaveBeenCalledOnce();
  });

  it("não sobrescreve uma edição concorrente", async () => {
    const client = clientMock(null);
    mocks.createServerSupabaseClient.mockResolvedValue(client);

    const result = await saveBotMessageCustomizationAction(
      previousState,
      customizationForm(DEFAULT_BOT_MESSAGE_CUSTOMIZATION),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Outro administrador/);
    expect(mocks.synchronizePublishedDiscordStorefronts).not.toHaveBeenCalled();
    expect(mocks.synchronizeAllOpenDiscordTicketControls).not.toHaveBeenCalled();
  });

  it("salva e informa quando um ticket aberto não pôde ser sincronizado", async () => {
    const client = clientMock({ id: 1 });
    mocks.createServerSupabaseClient.mockResolvedValue(client);
    mocks.synchronizeAllOpenDiscordTicketControls.mockResolvedValue({
      processed: 2,
      synchronized: 1,
      missingChannelsClosed: 0,
      failed: 1,
      permissionsUpdated: 1,
      welcomeMessagesUpdated: 1,
    });

    const result = await saveBotMessageCustomizationAction(
      previousState,
      customizationForm(DEFAULT_BOT_MESSAGE_CUSTOMIZATION),
    );

    expect(result).toEqual({
      ok: true,
      message:
        "Personalização salva. 1 ticket(s) aberto(s) não puderam receber os novos controles agora.",
    });
  });
});

describe("action de ordenação dos produtos", () => {
  const productIds = [
    "7e8d6368-eb5a-4a52-b4f6-5e3d79b364ae",
    "0d5a282b-e86e-488a-907a-d1ce9e7cdd14",
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({
      authUserId: "10000000-0000-4000-8000-000000000001",
    });
    mocks.synchronizePublishedDiscordStorefronts.mockResolvedValue({
      published: 1,
      failed: 0,
      productEmojiFailures: 0,
    });
  });

  it("rejeita JSON inválido antes de autenticar", async () => {
    const formData = new FormData();
    formData.set("productIds", "não-é-json");

    const result = await saveProductOrderAction(formData);

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/ordem recebida é inválida/i);
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
  });

  it("salva a sequência completa e republica a vitrine", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: productIds.length, error: null });
    mocks.createServerSupabaseClient.mockResolvedValue({ rpc });
    const formData = new FormData();
    formData.set("productIds", JSON.stringify(productIds));

    const result = await saveProductOrderAction(formData);

    expect(rpc).toHaveBeenCalledWith("admin_reorder_products", {
      p_product_ids: productIds,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/catalogo/produtos");
    expect(mocks.synchronizePublishedDiscordStorefronts).toHaveBeenCalledOnce();
    expect(result).toEqual({
      ok: true,
      message: "Ordem dos produtos salva. Vitrine do Discord sincronizada.",
    });
  });

  it("pede recarga quando a lista mudou durante a edição", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "40001", message: "products_order_stale" },
    });
    mocks.createServerSupabaseClient.mockResolvedValue({ rpc });
    const formData = new FormData();
    formData.set("productIds", JSON.stringify(productIds));

    const result = await saveProductOrderAction(formData);

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/lista de produtos mudou/i);
    expect(mocks.synchronizePublishedDiscordStorefronts).not.toHaveBeenCalled();
  });
});

function customizationForm(
  config: unknown,
  notificationDiscordUserIds: unknown = DEFAULT_TICKET_NOTIFICATION_DISCORD_USER_IDS,
  ticketCloseAdminDiscordUserIds: unknown = DEFAULT_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS,
) {
  const formData = new FormData();
  formData.set("config", JSON.stringify(config));
  formData.set("notificationDiscordUserIds", JSON.stringify(notificationDiscordUserIds));
  formData.set("ticketCloseAdminDiscordUserIds", JSON.stringify(ticketCloseAdminDiscordUserIds));
  formData.set("expectedUpdatedAt", updatedAt);
  return formData;
}

function clientMock(data: { id: number } | null) {
  const query = {
    eq: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data, error: null })),
  };
  query.eq.mockReturnValue(query);
  query.select.mockReturnValue(query);
  const update = vi.fn(() => query);
  return {
    update,
    eq: query.eq,
    from: vi.fn(() => ({ update })),
  };
}
