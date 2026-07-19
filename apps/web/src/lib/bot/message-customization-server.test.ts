import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: vi.fn(() => null),
}));

import { DEFAULT_BOT_MESSAGE_CUSTOMIZATION } from "./message-customization";
import {
  loadBotMessageCustomization,
  loadBotRuntimeSettings,
} from "./message-customization-server";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("bot runtime settings loader", () => {
  it("loads message customization and ticket notifications in one query", async () => {
    const query = settingsQuery({
      data: {
        bot_message_config: {
          version: 1,
          ticket: { title: "Pagamento aprovado" },
        },
        ticket_notification_discord_user_ids: [
          " 385924725332901909 ",
          "invalid",
          "911402638975844354",
          "385924725332901909",
        ],
        ticket_close_admin_discord_user_ids: [
          " 234486394414825472 ",
          "invalid",
          "911402638975844354",
          "234486394414825472",
        ],
      },
      error: null,
    });

    const result = await loadBotRuntimeSettings(query.client as never);

    expect(query.from).toHaveBeenCalledOnce();
    expect(query.from).toHaveBeenCalledWith("platform_settings");
    expect(query.select).toHaveBeenCalledOnce();
    expect(query.select).toHaveBeenCalledWith(
      "bot_message_config,ticket_notification_discord_user_ids,ticket_close_admin_discord_user_ids",
    );
    expect(query.eq).toHaveBeenCalledWith("id", 1);
    expect(query.maybeSingle).toHaveBeenCalledOnce();
    expect(result.customization.ticket.title).toBe("Pagamento aprovado");
    expect(result.customization.ticket.description).toBe(
      DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket.description,
    );
    expect(result.ticketNotificationDiscordUserIds).toEqual([
      "385924725332901909",
      "911402638975844354",
    ]);
    expect(result.ticketCloseAdminDiscordUserIds).toEqual([
      "234486394414825472",
      "911402638975844354",
    ]);
  });

  it("preserves an explicitly empty notification list", async () => {
    const query = settingsQuery({
      data: {
        bot_message_config: DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
        ticket_notification_discord_user_ids: [],
        ticket_close_admin_discord_user_ids: [],
      },
      error: null,
    });

    await expect(loadBotRuntimeSettings(query.client as never)).resolves.toMatchObject({
      ticketNotificationDiscordUserIds: [],
      ticketCloseAdminDiscordUserIds: [],
    });
  });

  it("fails closed for sensitive Discord lists when Supabase is unavailable", async () => {
    await expect(loadBotRuntimeSettings(null)).resolves.toEqual({
      customization: DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
      ticketNotificationDiscordUserIds: [],
      ticketCloseAdminDiscordUserIds: [],
    });

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const query = settingsQuery({ data: null, error: { message: "column unavailable" } });
    await expect(loadBotRuntimeSettings(query.client as never)).resolves.toEqual({
      customization: DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
      ticketNotificationDiscordUserIds: [],
      ticketCloseAdminDiscordUserIds: [],
    });
    expect(consoleError).toHaveBeenCalledWith("[bot-runtime-settings] column unavailable");
  });

  it("keeps the existing customization-only wrapper", async () => {
    const query = settingsQuery({
      data: {
        bot_message_config: { version: 1, help: { title: "Ajuda personalizada" } },
        ticket_notification_discord_user_ids: [],
        ticket_close_admin_discord_user_ids: [],
      },
      error: null,
    });

    const customization = await loadBotMessageCustomization(query.client as never);
    expect(customization.help.title).toBe("Ajuda personalizada");
    expect(query.maybeSingle).toHaveBeenCalledOnce();
  });
});

function settingsQuery(result: {
  data: unknown;
  error: { message: string } | null;
}) {
  const maybeSingle = vi.fn(async () => result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from }, from, select, eq, maybeSingle };
}
