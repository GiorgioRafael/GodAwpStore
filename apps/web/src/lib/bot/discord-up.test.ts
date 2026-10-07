import { describe, expect, it } from "vitest";
import { findUpService, GW_UP_CATEGORIES } from "./gw-up-catalog";
import { parseUpInteraction, upEntryMessage, upQuantityModal, upServiceMessage } from "./discord-up";
const services = GW_UP_CATEGORIES.flatMap(category => category.services);
function submitted(id: string, values: Record<string, string>) {
  return { type: 5, data: { custom_id: `gwu:submit:${id}`, components: Object.entries(values).map(([custom_id, value]) => ({ type: 1, components: [{ type: 4, custom_id, value }] })) } };
}
describe("GWStore UP checkout", () => {
  it("preserva preços de pacotes e requisitos da tabela", () => {
    expect(GW_UP_CATEGORIES).toHaveLength(13);
    expect(services).toHaveLength(80);
    expect(new Set(services.map(service => service.id)).size).toBe(80);
    expect(services.find(service => service.name === "1.000 Desvios")?.priceCents).toBe(1500);
    expect(services.find(service => service.name === "God Human")?.priceCents).toBe(5000);
    expect(services.find(service => service.name === "CDK")?.requirements).toContain("Yama + Tushita");
    expect(services.find(service => service.name === "Draco V3")?.requirements).toContain("Rainbow Haki");
    expect(GW_UP_CATEGORIES.find(category => category.key === "v4")?.services.every(service => service.requirements.includes("Não inclui Draco"))).toBe(true);
  });
  it("seleciona serviços apenas da categoria correta", () => {
    const id = services[0].id;
    expect(parseUpInteraction({ type: 3, data: { custom_id: "gwu:service:geral", values: [id] } })).toEqual({ kind: "service", productId: id });
    expect(parseUpInteraction({ type: 3, data: { custom_id: "gwu:service:espadas", values: [id] } })).toBeNull();
  });
  it("500 níveis são cinco pacotes de R$ 2 e exigem confirmação", () => {
    const service = services.find(service => service.name === "Level · 100 níveis")!;
    const parsed = parseUpInteraction(submitted(service.id, { packages: "5", requirements: "sim" }));
    expect(parsed).toMatchObject({ kind: "submit", quantity: 5, confirmed: true });
    expect(service.priceCents * 5).toBe(1000);
    expect(parseUpInteraction(submitted(service.id, { packages: "5", requirements: "não" }))).toMatchObject({ confirmed: false });
    for (const packages of ["0", "-1", "1.5", "10001", "abc"]) expect(parseUpInteraction(submitted(service.id, { packages, requirements: "SIM" }))).toMatchObject({ quantity: null });
  });
  it("não multiplica pacote fechado por valor injetado no formulário", () => {
    const service = services.find(service => service.name === "1.000 Desvios")!;
    expect(parseUpInteraction(submitted(service.id, { packages: "100", requirements: "SIM" }))).toMatchObject({ quantity: 1 });
    expect(upQuantityModal(service.id).data.components).toHaveLength(1);
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
