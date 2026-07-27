import { describe, expect, it } from "vitest";

import {
  OVERLAY_QUEUE_DEFAULT,
  OVERLAY_QUEUE_MAXIMUM,
  OVERLAY_QUEUE_MINIMUM,
  normalizeOverlayQueueLimit,
  withOverlayQueueLimit,
} from "./overlay-queue";

const OVERLAY = "https://gwstore.vercel.app/roleta/overlay?token=segredo";

describe("fila do overlay", () => {
  it("aceita a faixa que a página do overlay aceita", () => {
    expect(normalizeOverlayQueueLimit(OVERLAY_QUEUE_MINIMUM)).toBe(OVERLAY_QUEUE_MINIMUM);
    expect(normalizeOverlayQueueLimit(OVERLAY_QUEUE_MAXIMUM)).toBe(OVERLAY_QUEUE_MAXIMUM);
    expect(normalizeOverlayQueueLimit("12")).toBe(12);
  });

  it("cai no padrão em qualquer valor que a página recusaria", () => {
    for (const value of [undefined, null, "", "abc", "0", "51", "-3", "2.5", "1e400"]) {
      expect(normalizeOverlayQueueLimit(value)).toBe(OVERLAY_QUEUE_DEFAULT);
    }
  });

  it("mantém o link curto quando a fila é a padrão", () => {
    expect(withOverlayQueueLimit(OVERLAY, OVERLAY_QUEUE_DEFAULT)).toBe(OVERLAY);
    // Um link que já trazia a fila volta a ficar sem ela.
    expect(withOverlayQueueLimit(`${OVERLAY}&fila=20`, OVERLAY_QUEUE_DEFAULT)).toBe(OVERLAY);
  });

  it("escreve a fila sem perder o token nem duplicar o parâmetro", () => {
    const url = new URL(withOverlayQueueLimit(`${OVERLAY}&fila=5`, 20));

    expect(url.searchParams.get("token")).toBe("segredo");
    expect(url.searchParams.getAll("fila")).toEqual(["20"]);
  });

  it("normaliza antes de escrever, para nunca gerar um link que a página recusa", () => {
    const url = new URL(withOverlayQueueLimit(OVERLAY, 999));

    expect(url.searchParams.get("fila")).toBeNull();
    expect(normalizeOverlayQueueLimit(url.searchParams.get("fila"))).toBe(OVERLAY_QUEUE_DEFAULT);
  });

  it("devolve o valor original quando o endereço não é uma URL", () => {
    expect(withOverlayQueueLimit("nao-e-url", 12)).toBe("nao-e-url");
  });
});
