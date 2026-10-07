import { beforeEach, describe, expect, it, vi } from "vitest";
import { GW_UP_CATEGORIES, GW_UP_GUILD_ID, GW_UP_STORE_ID } from "./gw-up-catalog";
const mocks = vi.hoisted(() => ({ client: vi.fn(), catalog: vi.fn(), purchase: vi.fn(async () => false), fetcher: vi.fn<typeof fetch>(async () => new Response("{}")) }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: mocks.client }));
vi.mock("./supabase-repository", () => ({ SupabaseBotCommerceRepository: class { listCatalog = mocks.catalog; } }));
vi.mock("./discord-cart", () => ({ completeDiscordCartPurchase: mocks.purchase }));
vi.mock("./message-customization-server", () => ({ loadBotMessageCustomization: vi.fn(async () => ({})) }));
import { completeUpInteraction } from "./discord-up-server";
const channelId = "123456789012345678";
const messageId = "223456789012345678";
const service = GW_UP_CATEGORIES[0].services[0];
const raw = { guild_id: GW_UP_GUILD_ID, channel_id: channelId, id: "323456789012345678", member: { user: { id: "423456789012345678" } }, application_id: "523456789012345678", token: "up_test_interaction_token_12345678", message: { id: messageId, flags: 0 } };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DISCORD_APPLICATION_ID", raw.application_id);
  const query = { select: vi.fn(() => query), eq: vi.fn(() => query), is: vi.fn(() => query), maybeSingle: vi.fn(async () => ({ error: null, data: { configuration: { up_services: { channel_id: channelId, message_id: messageId, catalog_store_id: GW_UP_STORE_ID } } } })) };
  mocks.client.mockReturnValue({ from: vi.fn(() => query) });
  mocks.catalog.mockResolvedValue([{ catalogStoreId: GW_UP_STORE_ID, substores: [{ products: [{ ...service, description: "Pacotes de 100 níveis.", availableStock: 0, unlimitedStock: true, sortOrder: 0 }] }] }]);
});
describe("GW UP interaction validation", () => {
  it("revalida catálogo e encaminha somente o serviço confirmado ao checkout existente", async () => {
    await completeUpInteraction(raw, { kind: "submit", productId: service.id, quantity: 5, confirmed: true }, mocks.fetcher);
    expect(mocks.purchase).toHaveBeenCalledWith(raw, {}, [{ productId: service.id, quantity: 5 }]);
  });
  it("uma pausa feita no painel bloqueia um formulário antigo", async () => {
    mocks.catalog.mockResolvedValue([]);
    await completeUpInteraction(raw, { kind: "submit", productId: service.id, quantity: 5, confirmed: true }, mocks.fetcher);
    expect(mocks.purchase).not.toHaveBeenCalled();
    expect(JSON.parse(mocks.fetcher.mock.calls[0][1]!.body as string).content).toContain("pausado");
  });
  it.each([{ kind: "submit", productId: service.id, quantity: 5, confirmed: false } as const, { kind: "submit", productId: service.id, quantity: null, confirmed: true } as const])("não gera Pix para confirmação ou quantidade inválida", async interaction => {
    await completeUpInteraction(raw, interaction, mocks.fetcher);
    expect(mocks.purchase).not.toHaveBeenCalled();
  });
  it("bloqueia interações em outro canal ou servidor", async () => {
    for (const override of [{ channel_id: "623456789012345678" }, { guild_id: "723456789012345678" }]) await completeUpInteraction({ ...raw, ...override }, { kind: "submit", productId: service.id, quantity: 5, confirmed: true }, mocks.fetcher);
    expect(mocks.purchase).not.toHaveBeenCalled();
  });
  it("recusa seletores públicos substituídos", async () => {
    await completeUpInteraction({ ...raw, message: { ...raw.message, id: "823456789012345678" } }, { kind: "category", categoryKey: "geral" }, mocks.fetcher);
    expect(mocks.catalog).not.toHaveBeenCalled();
    expect(mocks.purchase).not.toHaveBeenCalled();
  });
});
