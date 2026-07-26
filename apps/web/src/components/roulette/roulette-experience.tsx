"use client";

import {
  Box,
  Crown,
  Gem,
  Gift,
  PackageOpen,
  RotateCw,
  Sparkles,
  Star,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState, useTransition } from "react";

import { spinDemoRoulette } from "@/app/roleta/actions";
import { BrandMark } from "@/components/layout/brand-mark";
import {
  DEMO_ROULETTE_PRIZES,
  demoRoulettePrize,
  demoRouletteRotation,
  mergeDemoRouletteInventory,
  type DemoRouletteInventoryItem,
  type DemoRoulettePrizeKey,
} from "@/lib/roulette/demo";

const PRIZE_ICONS: Record<DemoRoulettePrizeKey, LucideIcon> = {
  premio_1: Gift,
  premio_2: Star,
  premio_3: Zap,
  premio_4: Gem,
  premio_5: Crown,
};

const WHEEL_SIZE = 360;
const WHEEL_CENTER = WHEEL_SIZE / 2;
const WHEEL_RADIUS = 164;

export function RouletteExperience({
  initialInventory,
  available = true,
}: {
  initialInventory: DemoRouletteInventoryItem[];
  available?: boolean;
}) {
  const [inventory, setInventory] = useState(initialInventory);
  const [lastPrizeKey, setLastPrizeKey] = useState<DemoRoulettePrizeKey | null>(null);
  const [rotation, setRotation] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const rotationRef = useRef(0);
  const totalPrizes = inventory.reduce((total, item) => total + item.quantity, 0);

  function handleSpin() {
    if (isPending || !available) return;
    setFeedback(null);

    startTransition(async () => {
      const result = await spinDemoRoulette();
      if (!result.ok) {
        setFeedback(result.message);
        return;
      }

      const nextRotation = demoRouletteRotation(rotationRef.current, result.prizeKey);
      rotationRef.current = nextRotation;
      setRotation(nextRotation);

      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      await new Promise((resolve) => window.setTimeout(resolve, reduceMotion ? 80 : 2_900));

      setInventory((current) =>
        mergeDemoRouletteInventory(
          current,
          result.prizeKey,
          result.inventoryQuantity,
        ),
      );
      setLastPrizeKey(result.prizeKey);
    });
  }

  return (
    <main className="relative min-h-[calc(100vh-76px)] overflow-hidden bg-[#050306] text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_28%_22%,rgba(217,70,239,.11),transparent_32%),radial-gradient(circle_at_84%_78%,rgba(126,34,206,.08),transparent_30%)]"
      />
      <div className="relative mx-auto grid max-w-[1440px] gap-10 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,.85fr)] lg:gap-0 lg:px-10 [@media(max-height:820px)]:py-7">
        <section className="min-w-0 lg:pr-10 xl:pr-14">
          <h1 className="max-w-3xl text-3xl font-semibold tracking-[-0.045em] text-[#fbf8fc] sm:text-4xl lg:text-[44px] lg:leading-[1.08]">
            Gire e descubra seu prêmio
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#ae98b7] sm:text-base">
            Uma experiência gratuita enquanto preparamos a versão completa.
          </p>

          <div className="mt-7 grid items-center gap-7 xl:grid-cols-[minmax(0,560px)_minmax(170px,1fr)] [@media(max-height:820px)]:mt-4">
            <div className="mx-auto w-full max-w-[560px]">
              <div className="relative mx-auto aspect-square w-full max-w-[520px] [@media(max-height:820px)]:max-w-[400px]">
                <div
                  aria-hidden="true"
                  className="absolute inset-[3%] rounded-full bg-fuchsia-500/10 blur-3xl"
                />
                <span
                  aria-hidden="true"
                  className="absolute left-1/2 top-[-1px] z-20 h-0 w-0 -translate-x-1/2 drop-shadow-[0_0_12px_rgba(244,114,182,.95)]"
                  style={{
                    borderLeft: "clamp(18px, 4vw, 22px) solid transparent",
                    borderRight: "clamp(18px, 4vw, 22px) solid transparent",
                    borderTop: "clamp(32px, 6vw, 39px) solid #e879f9",
                  }}
                />
                <div className="absolute inset-[5.5%] rounded-full border border-fuchsia-200/35 bg-[#0b0710] p-[2.2%] shadow-[0_0_0_5px_rgba(217,70,239,.06),0_0_54px_rgba(217,70,239,.24),inset_0_0_28px_rgba(217,70,239,.12)]">
                  <svg
                    viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`}
                    role="img"
                    aria-label="Roleta com cinco prêmios provisórios"
                    className="size-full overflow-visible rounded-full will-change-transform"
                    style={{
                      transform: `rotate(${rotation}deg)`,
                      transformOrigin: "50% 50%",
                      transitionDuration: isPending ? "2800ms" : "0ms",
                      transitionProperty: "transform",
                      transitionTimingFunction: "cubic-bezier(.12,.68,.08,1)",
                    }}
                  >
                    <circle
                      cx={WHEEL_CENTER}
                      cy={WHEEL_CENTER}
                      r={WHEEL_RADIUS + 5}
                      fill="#08040c"
                      stroke="rgba(244,114,182,.72)"
                      strokeWidth="3"
                    />
                    {DEMO_ROULETTE_PRIZES.map((prize, index) => {
                      const path = wheelSegmentPath(index);
                      const label = wheelLabelPoint(index);
                      return (
                        <g key={prize.key}>
                          <path
                            d={path}
                            fill={prize.surface}
                            stroke="rgba(232,121,249,.36)"
                            strokeWidth="1.6"
                          />
                          <circle
                            cx={label.x}
                            cy={label.y - 18}
                            r="15"
                            fill="rgba(0,0,0,.2)"
                            stroke={prize.accent}
                            strokeOpacity=".45"
                          />
                          <text
                            x={label.x}
                            y={label.y - 14}
                            textAnchor="middle"
                            fill={prize.accent}
                            fontSize="17"
                            fontWeight="800"
                          >
                            {index + 1}
                          </text>
                          <text
                            x={label.x}
                            y={label.y + 17}
                            textAnchor="middle"
                            fill="#fff8ff"
                            fontSize="15"
                            fontWeight="700"
                          >
                            {prize.shortName}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                  <span className="absolute left-1/2 top-1/2 grid size-[25%] -translate-x-1/2 -translate-y-1/2 place-items-center overflow-hidden rounded-full border-2 border-fuchsia-200/55 bg-[#08040c] p-[8px] shadow-[0_0_25px_rgba(217,70,239,.42)]">
                    <BrandMark className="rounded-full" />
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSpin}
                disabled={isPending || !available}
                className="mx-auto mt-4 flex h-14 w-full max-w-[420px] items-center justify-center gap-3 rounded-2xl border border-fuchsia-200/55 bg-gradient-to-b from-fuchsia-500 to-[#b81780] px-6 text-base font-bold text-white shadow-[0_0_0_3px_rgba(217,70,239,.1),0_15px_40px_rgba(217,70,239,.24)] transition-[filter,transform] hover:-translate-y-0.5 hover:brightness-110 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-55 sm:text-lg"
              >
                <RotateCw
                  aria-hidden="true"
                  className={`size-5 ${isPending ? "animate-spin" : ""}`}
                />
                {isPending ? "Girando..." : "Girar roleta"}
              </button>
              <p className="mt-3 text-center text-xs leading-5 text-[#8f7a98]">
                O resultado é salvo no seu inventário.
              </p>
              {!available ? (
                <p
                  role="alert"
                  className="mx-auto mt-4 max-w-md rounded-xl border border-amber-300/25 bg-amber-300/[0.07] px-4 py-3 text-center text-sm text-amber-100"
                >
                  O inventário está temporariamente indisponível.
                </p>
              ) : null}
              {feedback ? (
                <p
                  role="alert"
                  className="mx-auto mt-4 max-w-md rounded-xl border border-rose-400/25 bg-rose-400/[0.08] px-4 py-3 text-center text-sm text-rose-200"
                >
                  {feedback}
                </p>
              ) : null}
            </div>

            <div
              aria-live="polite"
              className="mx-auto w-full max-w-sm text-center xl:text-left"
            >
              {lastPrizeKey ? (
                <div className="relative overflow-hidden border-y border-fuchsia-300/30 py-6">
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(217,70,239,.13),transparent_65%)]"
                  />
                  <Sparkles
                    aria-hidden="true"
                    className="relative mx-auto size-5 text-fuchsia-300 xl:mx-0"
                  />
                  <p className="relative mt-2 text-sm text-[#b69dbf]">Você ganhou:</p>
                  <p
                    data-testid="roulette-result"
                    className="relative mt-1 text-3xl font-semibold tracking-[-0.04em] text-white"
                  >
                    {demoRoulettePrize(lastPrizeKey).name}
                  </p>
                </div>
              ) : (
                <div className="border-y border-fuchsia-300/15 py-6">
                  <Sparkles
                    aria-hidden="true"
                    className="mx-auto size-5 text-fuchsia-300/65 xl:mx-0"
                  />
                  <p className="mt-3 text-sm leading-6 text-[#9e88a8]">
                    Seu próximo prêmio aparecerá aqui quando a roleta parar.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        <aside
          id="inventario"
          className="scroll-mt-24 border-t border-fuchsia-300/15 pt-9 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0 xl:pl-14"
        >
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">
                Seu inventário
              </h2>
              <p className="mt-2 text-sm text-[#a88fb2]">
                {totalPrizes === 1 ? "1 prêmio" : `${totalPrizes} prêmios`}
              </p>
            </div>
            <Box aria-hidden="true" className="mb-1 size-5 text-fuchsia-300/75" />
          </div>

          {inventory.length ? (
            <ul className="mt-7 space-y-3">
              {inventory.map((item) => {
                const prize = demoRoulettePrize(item.prizeKey);
                const Icon = PRIZE_ICONS[item.prizeKey];
                return (
                  <li
                    key={item.prizeKey}
                    className="grid grid-cols-[52px_1fr_auto] items-center gap-4 overflow-hidden rounded-2xl border border-fuchsia-300/20 bg-[#100a15]/90 p-3.5 shadow-[inset_0_1px_rgba(255,255,255,.025)]"
                  >
                    <span
                      className="grid size-[52px] place-items-center rounded-xl border bg-black/20"
                      style={{
                        borderColor: `${prize.accent}55`,
                        color: prize.accent,
                        backgroundColor: `${prize.surface}cc`,
                      }}
                    >
                      <Icon aria-hidden="true" className="size-5" strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 truncate text-sm font-semibold text-[#fbf8fc]">
                      {prize.name}
                    </span>
                    <span
                      className="min-w-10 border-l border-fuchsia-300/15 pl-4 text-center text-xl font-bold"
                      style={{ color: prize.accent }}
                      aria-label={`Quantidade: ${item.quantity}`}
                    >
                      {item.quantity}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mt-7 grid min-h-56 place-items-center rounded-2xl border border-dashed border-fuchsia-300/25 bg-[#0e0913]/75 px-6 text-center">
              <div>
                <PackageOpen
                  aria-hidden="true"
                  className="mx-auto size-9 text-fuchsia-300/45"
                  strokeWidth={1.5}
                />
                <p className="mt-4 text-sm font-medium text-[#d7c9dc]">
                  Seu inventário está vazio
                </p>
                <p className="mx-auto mt-2 max-w-xs text-xs leading-5 text-[#8f7b98]">
                  Gire a roleta para receber seu primeiro prêmio provisório.
                </p>
              </div>
            </div>
          )}

          <div className="mt-5 flex gap-3 border-t border-fuchsia-300/10 pt-5 text-xs leading-5 text-[#87728f]">
            <Gift aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fuchsia-300/55" />
            <p>
              Os cinco nomes são provisórios. Itens reais e formas de uso serão adicionados
              em uma próxima etapa.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}

function wheelSegmentPath(index: number) {
  const segmentAngle = 360 / DEMO_ROULETTE_PRIZES.length;
  const start = index * segmentAngle - 90;
  const end = start + segmentAngle;
  const startPoint = polarPoint(start);
  const endPoint = polarPoint(end);
  return [
    `M ${WHEEL_CENTER} ${WHEEL_CENTER}`,
    `L ${startPoint.x} ${startPoint.y}`,
    `A ${WHEEL_RADIUS} ${WHEEL_RADIUS} 0 0 1 ${endPoint.x} ${endPoint.y}`,
    "Z",
  ].join(" ");
}

function wheelLabelPoint(index: number) {
  const segmentAngle = 360 / DEMO_ROULETTE_PRIZES.length;
  return polarPoint(index * segmentAngle - 90 + segmentAngle / 2, 105);
}

function polarPoint(angle: number, radius = WHEEL_RADIUS) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: WHEEL_CENTER + Math.cos(radians) * radius,
    y: WHEEL_CENTER + Math.sin(radians) * radius,
  };
}
