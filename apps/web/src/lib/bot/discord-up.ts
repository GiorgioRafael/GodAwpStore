import { findUpService, GW_UP_CATEGORIES, GW_UP_ENTRY_TITLE, type UpCategoryDefinition } from "./gw-up-catalog";
import type { BotCatalogProduct } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type UpInteraction =
  | { kind: "categories" }
  | { kind: "category"; categoryKey: string }
  | { kind: "service"; productId: string }
  | { kind: "quantity"; productId: string }
  | { kind: "submit"; productId: string; quantity: number | null; confirmed: boolean };

export function parseUpInteraction(raw: unknown): UpInteraction | null {
  if (!object(raw) || !object(raw.data) || typeof raw.data.custom_id !== "string") return null;
  const id = raw.data.custom_id;
  if (raw.type === 3) {
    if (id === "gwu:categories") return { kind: "categories" };
    if (id === "gwu:category" && Array.isArray(raw.data.values) && raw.data.values.length === 1 &&
      typeof raw.data.values[0] === "string") {
      const categoryKey = raw.data.values[0];
      if (!GW_UP_CATEGORIES.some(category => category.key === categoryKey)) return null;
      return { kind: "category", categoryKey: raw.data.values[0] as string };
    }
    if (id.startsWith("gwu:service:") && Array.isArray(raw.data.values) && raw.data.values.length === 1) {
      const productId = raw.data.values[0];
      const service = typeof productId === "string" && UUID.test(productId) ? findUpService(productId) : null;
      return service && id === `gwu:service:${service.categoryKey}` ? { kind: "service", productId: service.id } : null;
    }
    if (id.startsWith("gwu:quantity:")) {
      const productId = id.slice("gwu:quantity:".length);
      return findUpService(productId) ? { kind: "quantity", productId } : null;
    }
  }
  if (raw.type === 5 && id.startsWith("gwu:submit:")) {
    const productId = id.slice("gwu:submit:".length);
    const service = findUpService(productId);
    if (!service) return null;
    const fields = new Map<string, string>();
    const visit = (value: unknown) => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!object(value)) return;
      if (typeof value.custom_id === "string" && typeof value.value === "string") fields.set(value.custom_id, value.value.trim());
      if (Array.isArray(value.components)) visit(value.components);
    };
    visit(raw.data.components);
    const value = service.unit === "serviço" ? "1" : fields.get("packages") ?? "";
    const quantity = /^\d{1,5}$/.test(value) && Number(value) >= 1 && Number(value) <= 10000 ? Number(value) : null;
    return { kind: "submit", productId, quantity, confirmed: fields.get("requirements")?.toLocaleLowerCase("pt-BR") === "sim" };
  }
  return null;
}

export function upEntryMessage() {
  return {
    allowed_mentions: { parse: [] },
    embeds: [{ title: GW_UP_ENTRY_TITLE, color: 0xb83cbf,
      description: "**Blox Fruits • contratação pelo bot**\n\n**1.** Escolha uma categoria abaixo.\n**2.** Selecione o serviço e confira o preço e os requisitos.\n**3.** Confirme e pague pelo Pix.\n\n✅ Após a confirmação do pagamento, o bot abre seu **ticket privado de compra** para combinar a execução com a equipe.\n\n📈 Level, Beli, maestria, fragmentos e bounty são cobrados por pacotes. As demais opções mostram o preço do serviço completo.\n⚠️ Leia os requisitos antes de pagar. **O UP é executado pela equipe da GWStore.**",
      footer: { text: "Sua seleção e o pagamento ficam visíveis apenas para você." } }],
    components: [{ type: 1, components: [{ type: 3, custom_id: "gwu:category", placeholder: "Qual serviço você procura?", min_values: 1, max_values: 1,
      options: GW_UP_CATEGORIES.map(category => ({ label: category.name, value: category.key, emoji: { name: category.emoji } })) }] }],
  };
}
export function upCategoryMessage(category: UpCategoryDefinition, products: BotCatalogProduct[]) {
  if (!products.length) return upText("Esta categoria está pausada no momento. Escolha outra categoria abaixo.", true);
  return {
    allowed_mentions: { parse: [] },
    embeds: [{ title: `${category.emoji} ${category.name}`, color: 0xb83cbf,
      description: products.map(product => `**${product.name}** — ${brl(product.priceCents)}`).join("\n") + "\n\nSelecione o serviço para conferir os requisitos antes do pagamento." }],
    components: [{ type: 1, components: [{ type: 3, custom_id: `gwu:service:${category.key}`, placeholder: "Escolha seu serviço de UP", min_values: 1, max_values: 1,
      options: products.map(product => ({ label: product.name.slice(0, 100), value: product.id, description: `${brl(product.priceCents)} • conferir requisitos`.slice(0, 100) })) }] }, navigation()],
  };
}
export function upServiceMessage(product: BotCatalogProduct) {
  const service = findUpService(product.id)!;
  const repeatable = service.unit !== "serviço";
  return { allowed_mentions: { parse: [] },
    embeds: [{ title: product.name, color: 0xb83cbf,
      description: `**Preço${repeatable ? " por pacote" : " do serviço"}: ${brl(product.priceCents)}**\n${repeatable ? `Cada quantidade corresponde a **${service.unit}**.\n` : ""}\n**📌 Requisitos e detalhes**\n${(product.description || service.requirements || "Combine os detalhes de execução com a equipe no ticket.").slice(0, 3000)}\n\nAo continuar, confirme que leu os requisitos. O valor final será mostrado antes de pagar, incluindo os descontos da loja quando aplicáveis.\n\n🔒 Não envie senha, código de verificação ou acesso à conta neste formulário.` }],
    components: [{ type: 1, components: [{ type: 2, style: 3, custom_id: `gwu:quantity:${product.id}`, label: repeatable ? "Definir quantidade e continuar" : "Conferir e continuar" }] }, navigation()],
  };
}
export function upQuantityModal(productId: string) {
  const service = findUpService(productId)!;
  const input = (custom_id: string, label: string, placeholder: string, value?: string) => ({ type: 1, components: [{ type: 4, custom_id, label, style: 1, required: true, max_length: custom_id === "packages" ? 5 : 3, placeholder, ...(value ? { value } : {}) }] });
  return { type: 9, data: { custom_id: `gwu:submit:${productId}`, title: "Confirmar serviço de UP", components: [
    ...(service.unit !== "serviço" ? [input("packages", `Pacotes de ${service.unit}`.slice(0, 45), "Número de pacotes, ex.: 5", "1")] : []),
    input("requirements", "Leu e atende aos requisitos? Digite SIM", "SIM"),
  ] } };
}
export function upText(content: string, withNavigation = false) {
  return { content, allowed_mentions: { parse: [] }, components: withNavigation ? [navigation()] : [] };
}
function navigation() { return { type: 1, components: [{ type: 2, style: 2, custom_id: "gwu:categories", label: "Outras categorias" }] }; }
export function brl(cents: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100); }
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
