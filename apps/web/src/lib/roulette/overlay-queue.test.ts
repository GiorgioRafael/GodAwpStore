import { describe, expect, it } from "vitest";

import {
  OVERLAY_BACKGROUNDS,
  normalizeOverlayBackground,
  withOverlayBackground,
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

describe("fundo do overlay", () => {
  it("cai em transparente, que é o que o OBS recorta sozinho", () => {
    for (const value of [undefined, null, "", "azul", "TRANSPARENTE ", "chroma"]) {
      expect(normalizeOverlayBackground(value)).toBe("transparente");
    }
  });

  it("aceita as opções de chroma key", () => {
    expect(normalizeOverlayBackground("verde")).toBe("verde");
    expect(normalizeOverlayBackground(" Magenta ")).toBe("magenta");
    expect(normalizeOverlayBackground("preto")).toBe("preto");
  });

  it("mantém o link curto no padrão e escreve só o que foge dele", () => {
    expect(withOverlayBackground(OVERLAY, "transparente")).toBe(OVERLAY);
    expect(withOverlayBackground(`${OVERLAY}&fundo=verde`, "transparente")).toBe(OVERLAY);
    expect(new URL(withOverlayBackground(OVERLAY, "verde")).searchParams.get("fundo")).toBe("verde");
  });

  it("convive com a fila sem perder o token", () => {
    const url = new URL(
      withOverlayBackground(withOverlayQueueLimit(OVERLAY, 20), "verde"),
    );

    expect(url.searchParams.get("token")).toBe("segredo");
    expect(url.searchParams.get("fila")).toBe("20");
    expect(url.searchParams.get("fundo")).toBe("verde");
  });

  it("cada opção resolve para uma cor que dá para keyar", () => {
    // Verde e magenta puros são o que o filtro do OBS espera de fábrica.
    expect(OVERLAY_BACKGROUNDS.transparente).toBe("transparent");
    expect(OVERLAY_BACKGROUNDS.verde).toBe("#00ff00");
    expect(OVERLAY_BACKGROUNDS.magenta).toBe("#ff00ff");
  });
});
