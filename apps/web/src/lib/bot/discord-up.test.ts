import { describe, expect, it } from "vitest";
import { findUpService, GW_UP_CATEGORIES, GW_UP_RETIRED_SERVICE_IDS, upServiceDescription } from "./gw-up-catalog";
import { parseUpInteraction, upEntryMessage, upQuantityModal, upServiceMessage } from "./discord-up";
const services = GW_UP_CATEGORIES.flatMap(category => category.services);
function submitted(id: string, values: Record<string, string>) {
  return { type: 5, data: { custom_id: `gwu:submit:${id}`, components: Object.entries(values).map(([custom_id, value]) => ({ type: 1, components: [{ type: 4, custom_id, value }] })) } };
}
describe("GWStore UP checkout", () => {
  it("preserva preços de pacotes e requisitos da tabela", () => {
    expect(GW_UP_CATEGORIES).toHaveLength(14);
    expect(GW_UP_CATEGORIES.slice(0, 2).map(category => category.key)).toEqual(["geral", "maestria"]);
    expect(services).toHaveLength(87);
    expect(new Set(services.map(service => service.id)).size).toBe(87);
    expect(services.find(service => service.name === "1.000 Desvios")?.priceCents).toBe(1500);
    expect(services.find(service => service.name === "God Human")?.priceCents).toBe(5000);
    expect(services.find(service => service.name === "CDK")?.requirements).toContain("Yama + Tushita");
    expect(services.find(service => service.name === "Draco V3")?.requirements).toContain("Rainbow Haki");
    expect(GW_UP_CATEGORIES.find(category => category.key === "v4")?.services.every(service => service.requirements.includes("Não inclui Draco"))).toBe(true);
  });
  it.each([
    ["Level 0–700", 2000], ["Level 700–1500", 2500], ["Level 1500–2800", 4500],
    ["Level avulso · 100 níveis", 350], ["Missões Secretas", 1000], ["Beli · 1M", 250],
    ["Maestria 0–250", 500], ["Maestria 250–400", 1000], ["Maestria 400–600", 1500], ["Maestria Full (0–600)", 2500],
    ["Cada espada TTK", 1000], ["TTK Full (3 espadas)", 3000], ["Yoru V3", 5000],
    ["3 engrenagens V4", 3000], ["Raça V4 Full", 5000], ["6 raças V4 Full", 28500],
  ])("aplica o valor da nova tabela para %s", (name, priceCents) => {
    expect(services.find(service => service.name === name)?.priceCents).toBe(priceCents);
  });
  it("retira opções antigas sem reaproveitar seus IDs", () => {
    expect(GW_UP_RETIRED_SERVICE_IDS).toHaveLength(4);
    for (const id of GW_UP_RETIRED_SERVICE_IDS) {
      expect(findUpService(id)).toBeNull();
      expect(parseUpInteraction({ type: 3, data: { custom_id: `gwu:quantity:${id}` } })).toBeNull();
      expect(parseUpInteraction(submitted(id, { packages: "1", requirements: "SIM" }))).toBeNull();
    }
    expect(findUpService("847545e9-cb9b-50db-bffd-237334e865f4"))
      .toMatchObject({ name: "Level avulso · 100 níveis", unit: "100 níveis" });
    expect(findUpService("646ef3f9-ef00-5884-a90f-3e5dc64d02fb"))
      .toMatchObject({ name: "Raça V4 Full", unit: "raça" });
  });
  it("informa o desconto de maestria antes do pedido e os detalhes do pacote V4", () => {
    const mastery = GW_UP_CATEGORIES.find(category => category.key === "maestria")!.services;
    expect(mastery).toHaveLength(4);
    for (const service of mastery) {
      expect(service.requirements).toContain("2x Maestria");
      expect(service.requirements).toContain("antes do pedido");
    }
    const full = services.find(service => service.name === "6 raças V4 Full")!;
    expect(full.priceCents).toBe(30_000 - 1_500);
    for (const text of ["3 engrenagens + treino Full", "R$ 300,00", "5%", "R$ 15,00", "R$ 285,00", "V3", "fragmentos"])
      expect(full.requirements).toContain(text);
    for (const name of ["Desbloquear Ghoul", "Desbloquear Cyborg"])
      expect(services.find(service => service.name === name)?.requirements).not.toContain("já possuir a raça desbloqueada");
  });
  it("seleciona serviços apenas da categoria correta", () => {
    const id = services[0].id;
    expect(parseUpInteraction({ type: 3, data: { custom_id: "gwu:service:geral", values: [id] } })).toEqual({ kind: "service", productId: id });
    expect(parseUpInteraction({ type: 3, data: { custom_id: "gwu:service:espadas", values: [id] } })).toBeNull();
  });
  it("500 níveis avulsos são cinco pacotes de R$ 3,50 e exigem confirmação", () => {
    const service = services.find(service => service.name === "Level avulso · 100 níveis")!;
    const parsed = parseUpInteraction(submitted(service.id, { packages: "5", requirements: "sim" }));
    expect(parsed).toMatchObject({ kind: "submit", quantity: 5, confirmed: true });
    expect(service.priceCents * 5).toBe(1750);
    expect(parseUpInteraction(submitted(service.id, { packages: "5", requirements: "não" }))).toMatchObject({ confirmed: false });
    for (const packages of ["0", "-1", "1.5", "10001", "abc"]) expect(parseUpInteraction(submitted(service.id, { packages, requirements: "SIM" }))).toMatchObject({ quantity: null });
  });
  it.each([
    "1.000 Desvios", "Level 0–700", "Level 700–1500", "Level 1500–2800",
    "Maestria 0–250", "Maestria 250–400", "Maestria 400–600", "Maestria Full (0–600)",
    "TTK Full (3 espadas)", "6 raças V4 Full",
  ])("não multiplica o pacote fechado %s por valor injetado no formulário", name => {
    const service = services.find(service => service.name === name)!;
    expect(parseUpInteraction(submitted(service.id, { packages: "100", requirements: "SIM" }))).toMatchObject({ quantity: 1 });
    expect(upQuantityModal(service.id).data.components).toHaveLength(1);
    expect(upServiceDescription(service)).toContain("Serviço completo.");
  });
  it.each([["3 engrenagens V4", 6000], ["Raça V4 Full", 10000]])("cobra %s pela quantidade de raças", (name, totalCents) => {
    const service = services.find(service => service.name === name)!;
    expect(parseUpInteraction(submitted(service.id, { packages: "2", requirements: "SIM" }))).toMatchObject({ quantity: 2 });
    expect(service.priceCents * 2).toBe(totalCents);
    expect(upQuantityModal(service.id).data.components[0].components[0].label).toBe("Quantidade de raças");
    const message = upServiceMessage({ ...service, description: upServiceDescription(service), availableStock: 0, unlimitedStock: true, sortOrder: 0 });
    expect(message.embeds[0].description).toContain("Preço por raça");
    expect(message.embeds[0].description).toContain("uma raça");
  });
  it("mostra preço atualizado no painel e os requisitos antes do modal", () => {
    const service = services.find(service => service.name === "CDK")!;
    const message = upServiceMessage({ id: service.id, name: service.name, priceCents: 1700, description: "É necessário possuir Yama + Tushita.", availableStock: 0, unlimitedStock: true, sortOrder: 0 });
    expect(message.embeds[0].description).toContain("17,00");
    expect(message.embeds[0].description).toContain("Yama + Tushita");
    expect(findUpService(service.id)).not.toBeNull();
    expect(upEntryMessage().components[0].components[0].options.length).toBeLessThanOrEqual(25);
  });
});
