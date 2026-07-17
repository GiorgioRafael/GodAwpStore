import { describe, expect, it } from "vitest";

import { resolveOrdersPeriod } from "./orders-period";

const NOW = new Date("2026-07-17T15:00:00.000Z");

describe("resolveOrdersPeriod", () => {
  it("usa todo o período por padrão", () => {
    expect(resolveOrdersPeriod({}, NOW)).toMatchObject({
      key: "all",
      from: null,
      to: null,
      error: null,
    });
  });

  it("resolve hoje no fuso de São Paulo", () => {
    expect(resolveOrdersPeriod({ period: "today" }, NOW)).toMatchObject({
      from: "2026-07-17T03:00:00.000Z",
      to: "2026-07-18T03:00:00.000Z",
      fromInput: "2026-07-17",
      toInput: "2026-07-17",
    });
  });

  it("inclui sete dias de calendário no período rápido", () => {
    expect(resolveOrdersPeriod({ period: "7d" }, NOW)).toMatchObject({
      from: "2026-07-11T03:00:00.000Z",
      to: "2026-07-18T03:00:00.000Z",
    });
  });

  it("torna a data final personalizada inclusiva", () => {
    expect(
      resolveOrdersPeriod(
        { period: "custom", from: "2026-07-01", to: "2026-07-10" },
        NOW,
      ),
    ).toMatchObject({
      from: "2026-07-01T03:00:00.000Z",
      to: "2026-07-11T03:00:00.000Z",
      label: "01/07/2026 a 10/07/2026",
      error: null,
    });
  });

  it("não aplica um intervalo personalizado inválido", () => {
    expect(
      resolveOrdersPeriod(
        { period: "custom", from: "2026-07-20", to: "2026-07-10" },
        NOW,
      ),
    ).toMatchObject({
      from: null,
      to: null,
      error: "A data inicial não pode ser posterior à data final.",
    });
  });
});
