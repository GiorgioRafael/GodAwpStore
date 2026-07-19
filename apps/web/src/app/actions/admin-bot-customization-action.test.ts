import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BOT_MESSAGE_CUSTOMIZATION } from "@/lib/bot/message-customization";
import { DEFAULT_TICKET_NOTIFICATION_DISCORD_USER_IDS } from "@/lib/bot/ticket-notifications";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
  synchronizePublishedDiscordStorefronts: vi.fn(),
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
        updated_by: "10000000-0000-4000-8000-000000000001",
      }),
    );
    expect(client.eq).toHaveBeenNthCalledWith(1, "id", 1);
    expect(client.eq).toHaveBeenNthCalledWith(2, "updated_at", updatedAt);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/customizacao-bot");
    expect(mocks.synchronizePublishedDiscordStorefronts).toHaveBeenCalledOnce();
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
  });
});

function customizationForm(
  config: unknown,
  notificationDiscordUserIds: unknown = DEFAULT_TICKET_NOTIFICATION_DISCORD_USER_IDS,
) {
  const formData = new FormData();
  formData.set("config", JSON.stringify(config));
  formData.set("notificationDiscordUserIds", JSON.stringify(notificationDiscordUserIds));
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
