import { describe, expect, it } from "vitest";

import { buildOrdersHref } from "./orders-query";

describe("buildOrdersHref", () => {
  it("omite filtros padrão da URL", () => {
    expect(buildOrdersHref({ period: "all", status: "all", page: 1 })).toBe("/pedidos");
  });

  it("preserva período, status e página", () => {
    expect(buildOrdersHref({ period: "7d", status: "paid", page: 3 })).toBe(
      "/pedidos?period=7d&status=paid&page=3",
    );
  });

  it("inclui datas somente no período personalizado", () => {
    expect(buildOrdersHref({
      period: "custom",
      status: "cancelled",
      from: "2026-07-01",
      to: "2026-07-22",
    })).toBe("/pedidos?period=custom&from=2026-07-01&to=2026-07-22&status=cancelled");
  });
});
