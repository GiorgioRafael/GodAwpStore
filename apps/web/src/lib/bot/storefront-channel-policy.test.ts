import { describe, expect, it } from "vitest";
import { isOperationalStorefrontChannel } from "./storefront-channel-policy";

describe("canais para vitrines de compra", () => {
  it.each(["ticket-628b8b191925", "🔒┊chat-admin", "chat-admin", "📩┊ticket-123"])("recusa %s", (name) => {
    expect(isOperationalStorefrontChannel(name)).toBe(true);
  });
  it.each(["🛒┊todas-as-lojas", "comprar-robux", "comprar-itens-world-outono"])("aceita %s", (name) => {
    expect(isOperationalStorefrontChannel(name)).toBe(false);
  });
});
