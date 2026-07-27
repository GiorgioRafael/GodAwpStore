import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  EXTRA_TURNS,
  isBigRoulettePrize,
  spinWheelTo,
  wheelLabelPoint,
  WHEEL_CENTER,
} from "./wheel";

describe("roulette wheel", () => {
  it("destaca só o prêmio que paga ao menos o dobro do giro", () => {
    // A escada em produção: 0,15 / 0,50 / 1,00 / 2,50 / 10,00.
    expect(isBigRoulettePrize(15)).toBe(false);
    expect(isBigRoulettePrize(50)).toBe(false);
    // Empatar o giro não é destaque.
    expect(isBigRoulettePrize(100)).toBe(false);
    expect(isBigRoulettePrize(250)).toBe(true);
    expect(isBigRoulettePrize(1_000)).toBe(true);
  });

  it("empilha nome e valor no eixo vertical, nunca no raio", () => {
    // Um deslocamento radial vira horizontal nas fatias laterais e o nome do
    // produto passa por cima do valor. Todas as fatias devem devolver um único
    // ponto, e o componente separa as duas linhas no eixo y.
    const total = 5;
    const points = Array.from({ length: total }, (_, index) =>
      wheelLabelPoint(index, total),
    );

    expect(points).toHaveLength(total);
    for (const point of points) {
      const distance = Math.hypot(point.x - WHEEL_CENTER, point.y - WHEEL_CENTER);
      expect(distance).toBeCloseTo(104, 5);
    }
  });

  it("cai no tempo quando a Web Animations API não existe", async () => {
    // jsdom não implementa animate; o giro não pode travar por causa disso.
    const settled = await spinWheelTo(null, 0, 720, 5);
    expect(settled).toBe(720);
  });

  it("anima do ângulo atual até o destino, com voltas de sobra", async () => {
    const calls: Array<{ keyframes: unknown; options: KeyframeAnimationOptions }> = [];
    const element = {
      animate: (keyframes: unknown, options: KeyframeAnimationOptions) => {
        calls.push({ keyframes, options });
        return { finished: Promise.resolve() };
      },
    } as unknown as SVGGElement;

    const to = 30 + EXTRA_TURNS * 360;
    const settled = await spinWheelTo(element, 30, to, 4_000);

    expect(settled).toBe(to);
    expect(calls).toHaveLength(1);
    expect(calls[0].options.duration).toBe(4_000);
    expect(calls[0].keyframes).toEqual([
      { transform: "rotate(30deg)" },
      { transform: `rotate(${to}deg)` },
    ]);
  });
});
