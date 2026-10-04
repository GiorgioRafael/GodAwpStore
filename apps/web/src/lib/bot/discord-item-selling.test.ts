import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BOT_MESSAGE_CUSTOMIZATION } from "./message-customization";
import { GODAWP_DISCORD_USER_ID, GWSTORE_SELLING_GUILD_ID, SELLING_COMPLETE_PREFIX, SELLING_OPEN_ID,
  SELLING_SUBMIT_ID, SELLING_CLOSE_PREFIX, SELLING_CLOSE_CONFIRM_PREFIX, SELLING_CLOSE_CANCEL_PREFIX,
  escapeSellingText, itemSellingResponse, parseItemSellingInteraction, sellingTicketComponents } from "./discord-item-selling";

const appId = "123456789012345678";
const channelId = "223456789012345678";
const sellerId = "323456789012345678";
const settings = { customization: DEFAULT_BOT_MESSAGE_CUSTOMIZATION, ticketCloseAdminDiscordUserIds: [], ticketNotificationDiscordUserIds: [] };
const raw = (type = 3, customId = SELLING_OPEN_ID, userId = sellerId) => ({
  type, id: "423456789012345678", application_id: appId, token: "abcdefghijklmnopqrstuvwxyz0123456789",
  guild_id: GWSTORE_SELLING_GUILD_ID, channel_id: channelId, member: { user: { id: userId } }, data: { custom_id: customId },
});
afterEach(() => vi.unstubAllEnvs());

describe("venda de itens para a GWStore", () => {
  it("abre formulário nativo sem depender do banco", () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", appId);
    expect(itemSellingResponse(raw())).toMatchObject({ type: 9, data: {
      custom_id: SELLING_SUBMIT_ID, components: [{ type: 18, component: { custom_id: "item_name", required: true, max_length: 120 } }],
    } });
  });
  it("lê o campo Label e o formulário legado e rejeita branco ou texto longo", () => {
    for (const components of [
      [{ type: 18, component: { custom_id: "item_name", value: "  Dragon\n Fisica  " } }],
      [{ type: 1, components: [{ custom_id: "item_name", value: "  Dragon\n Fisica  " }] }],
    ]) expect(parseItemSellingInteraction({ ...raw(5, SELLING_SUBMIT_ID), data: { custom_id: SELLING_SUBMIT_ID, components } })).toEqual({ kind: "submit", itemName: "Dragon Fisica" });
    for (const value of ["  ", "x".repeat(121)]) expect(parseItemSellingInteraction({ ...raw(5, SELLING_SUBMIT_ID), data: { custom_id: SELLING_SUBMIT_ID, components: [{ component: { custom_id: "item_name", value } }] } })).toEqual({ kind: "submit", itemName: null });
  });
  it("restringe o atendimento ao servidor e ao aplicativo da GWStore", () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", appId);
    expect(itemSellingResponse({ ...raw(), guild_id: channelId }).type).toBe(4);
    expect(itemSellingResponse({ ...raw(), application_id: channelId }).type).toBe(4);
    expect(itemSellingResponse({ ...raw(), member: undefined }).type).toBe(4);
  });
  it("somente GodAwp ou os responsáveis dos outros tickets podem concluir, no próprio canal", () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", appId);
    const completeId = `${SELLING_COMPLETE_PREFIX}${channelId}`;
    expect(itemSellingResponse(raw(3, completeId), settings).type).toBe(4);
    expect(itemSellingResponse(raw(3, completeId, GODAWP_DISCORD_USER_ID), settings).type).toBe(5);
    expect(itemSellingResponse(raw(3, completeId), { ...settings, ticketCloseAdminDiscordUserIds: [sellerId] }).type).toBe(5);
    expect(itemSellingResponse(raw(3, `${SELLING_COMPLETE_PREFIX}${sellerId}`, GODAWP_DISCORD_USER_ID), settings).type).toBe(4);
  });
  it("escapa nomes de itens sem transformar menções e Markdown em conteúdo ativo", () => {
    expect(escapeSellingText("**Dragon** <@123> [x](url)")).toBe("\\*\\*Dragon\\*\\* \\<@123\\> \\[x\\]\\(url\\)");
  });
  it("mantém fechamento manual disponível antes e depois de concluir o ticket", () => {
    for (const completed of [false, true]) {
      const buttons = sellingTicketComponents(channelId, completed)[0].components;
      expect(buttons[0]).toMatchObject({ custom_id: `${SELLING_COMPLETE_PREFIX}${channelId}`, disabled: completed });
      expect(buttons[1]).toMatchObject({ custom_id: `${SELLING_CLOSE_PREFIX}${channelId}`, style: 4, label: "Fechar ticket" });
      expect(buttons[1].disabled).not.toBe(true);
    }
  });
  it.each([
    [SELLING_CLOSE_PREFIX, "close_request"],
    [SELLING_CLOSE_CONFIRM_PREFIX, "close_confirm"],
    [SELLING_CLOSE_CANCEL_PREFIX, "close_cancel"],
  ])("reconhece %s apenas como botão com um ID de canal válido", (prefix, kind) => {
    expect(parseItemSellingInteraction(raw(3, `${prefix}${channelId}`))).toEqual({ kind, channelId });
    expect(parseItemSellingInteraction(raw(5, `${prefix}${channelId}`))).toBeNull();
    expect(parseItemSellingInteraction(raw(3, `${prefix}abc`))).toBeNull();
    expect(parseItemSellingInteraction(raw(3, `${prefix}${channelId}:outro`))).toBeNull();
  });
  it.each([SELLING_CLOSE_PREFIX, SELLING_CLOSE_CONFIRM_PREFIX, SELLING_CLOSE_CANCEL_PREFIX])(
    "restringe %s à equipe autorizada e ao próprio canal", (prefix) => {
      vi.stubEnv("DISCORD_APPLICATION_ID", appId);
      const customId = `${prefix}${channelId}`;
      expect(itemSellingResponse(raw(3, customId), settings).type).toBe(4);
      expect(itemSellingResponse(raw(3, customId, GODAWP_DISCORD_USER_ID)).type).toBe(4);
      expect(itemSellingResponse(raw(3, `${prefix}${sellerId}`, GODAWP_DISCORD_USER_ID), settings).type).toBe(4);
      expect(itemSellingResponse({ ...raw(3, customId, GODAWP_DISCORD_USER_ID), guild_id: sellerId }, settings).type).toBe(4);
      expect(itemSellingResponse({ ...raw(3, customId, GODAWP_DISCORD_USER_ID), application_id: sellerId }, settings).type).toBe(4);
    },
  );
  it("exige confirmação privada, aceita o administrador e cancela sem fechar", () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", appId);
    const adminId = "523456789012345678";
    const adminSettings = { ...settings, ticketCloseAdminDiscordUserIds: [adminId] };
    expect(itemSellingResponse(raw(3, `${SELLING_CLOSE_PREFIX}${channelId}`, adminId), adminSettings)).toMatchObject({
      type: 4, data: { flags: 64, components: [{ components: [
        { custom_id: `${SELLING_CLOSE_CONFIRM_PREFIX}${channelId}`, label: "Confirmar fechamento" },
        { custom_id: `${SELLING_CLOSE_CANCEL_PREFIX}${channelId}`, label: "Cancelar" },
      ] }] },
    });
    expect(itemSellingResponse(raw(3, `${SELLING_CLOSE_CONFIRM_PREFIX}${channelId}`, GODAWP_DISCORD_USER_ID), settings)).toEqual({ type: 5, data: { flags: 64 } });
    expect(itemSellingResponse(raw(3, `${SELLING_CLOSE_CANCEL_PREFIX}${channelId}`, GODAWP_DISCORD_USER_ID), settings)).toMatchObject({
      type: 7, data: { content: "Fechamento cancelado. O ticket continua aberto.", components: [], allowed_mentions: { parse: [] } },
    });
  });
});
