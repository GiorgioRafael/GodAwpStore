"use client";

/* eslint-disable @next/next/no-img-element -- Catalog images use runtime Supabase URLs. */

import {
  Box,
  Coins,
  Crown,
  Gem,
  Gift,
  Loader2,
  Minus,
  PackageOpen,
  Plus,
  QrCode,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Star,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  getRouletteCoinPurchaseStatus,
  sellRoulettePrize,
  spinRoulette,
  startRouletteCoinPurchase,
} from "@/app/roleta/actions";
import { BrandMark } from "@/components/layout/brand-mark";
import {
  demoRouletteRotation,
  formatCoins,
  mergeDemoRouletteInventory,
  rouletteWheelPrize,
  MAXIMUM_COIN_PURCHASE,
  MINIMUM_COIN_PURCHASE,
  SPIN_COST_CENTS,
  type DemoRouletteInventoryItem,
  type DemoRoulettePrizeKey,
  type RouletteWheelPrize,
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
const PAYMENT_POLL_INTERVAL_MS = 4_000;

type Phase = "idle" | "preparing" | "awaiting_payment" | "spinning" | "selling";

export function RouletteExperience({
  prizes,
  initialInventory,
  initialBalanceCents = 0,
  available = true,
  isAdmin = false,
  initialPurchaseId = null,
}: {
  prizes: RouletteWheelPrize[];
  initialInventory: DemoRouletteInventoryItem[];
  initialBalanceCents?: number;
  available?: boolean;
  isAdmin?: boolean;
  initialPurchaseId?: string | null;
}) {
  const [inventory, setInventory] = useState(initialInventory);
  const [balanceCents, setBalanceCents] = useState(initialBalanceCents);
  const [lastPrizeKey, setLastPrizeKey] = useState<DemoRoulettePrizeKey | null>(null);
  const [rotation, setRotation] = useState(0);
  const [phase, setPhase] = useState<Phase>(initialPurchaseId ? "awaiting_payment" : "idle");
  const [purchaseId, setPurchaseId] = useState<string | null>(initialPurchaseId);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [coinQuantity, setCoinQuantity] = useState(MINIMUM_COIN_PURCHASE);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const rotationRef = useRef(0);
  const phaseRef = useRef(phase);
  const totalPrizes = inventory.reduce((total, item) => total + item.quantity, 0);
  const isBusy = phase !== "idle";
  const canSpin = isAdmin || balanceCents >= SPIN_COST_CENTS;

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const runSpin = useCallback(async () => {
    setPhase("spinning");
    setError(null);
    setNotice(null);

    const result = await spinRoulette();
    if (!result.ok) {
      setError(result.message);
      setPhase("idle");
      return;
    }

    setBalanceCents(result.balanceCents);
    const nextRotation = demoRouletteRotation(rotationRef.current, result.prizeKey);
    rotationRef.current = nextRotation;
    setRotation(nextRotation);

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    await new Promise((resolve) => window.setTimeout(resolve, reduceMotion ? 80 : 2_900));

    setInventory((current) =>
      mergeDemoRouletteInventory(current, result.prizeKey, result.inventoryQuantity),
    );
    setLastPrizeKey(result.prizeKey);
    setPhase("idle");
  }, []);

  // The coins land through the LivePix webhook, so the browser waits here until
  // the balance is credited.
  useEffect(() => {
    if (phase !== "awaiting_payment" || !purchaseId) return;

    let cancelled = false;
    async function check(pendingPurchaseId: string) {
      const status = await getRouletteCoinPurchaseStatus(pendingPurchaseId);
      if (cancelled || phaseRef.current !== "awaiting_payment") return;

      if (!status.ok) {
        setError(status.message);
        setPhase("idle");
        setPurchaseId(null);
        setCheckoutUrl(null);
        return;
      }
      setBalanceCents(status.balanceCents);
      if (status.status === "credited") {
        setNotice("Moedas creditadas. Bom giro!");
        setPhase("idle");
        setPurchaseId(null);
        setCheckoutUrl(null);
        return;
      }
      if (status.status === "expired") {
        setError("O Pix expirou antes da confirmação. Gere uma nova compra.");
        setPhase("idle");
        setPurchaseId(null);
        setCheckoutUrl(null);
      }
    }

    // Someone returning from the LivePix page may already be credited, so check
    // once right away instead of waiting a full poll interval.
    void check(purchaseId);
    const timer = window.setInterval(() => void check(purchaseId), PAYMENT_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [purchaseId, phase]);

  async function handleSpin() {
    if (isBusy || !available || !canSpin) return;
    await runSpin();
  }

  async function handleBuyCoins() {
    if (isBusy || !available) return;
    setError(null);
    setNotice(null);
    setPhase("preparing");

    const purchase = await startRouletteCoinPurchase(coinQuantity);
    if (!purchase.ok) {
      setError(purchase.message);
      setPhase("idle");
      return;
    }

    setPurchaseId(purchase.purchaseId);
    setCheckoutUrl(purchase.checkoutUrl);
    setPhase("awaiting_payment");
    if (purchase.checkoutUrl) {
      window.open(purchase.checkoutUrl, "_blank", "noopener,noreferrer");
    }
  }

  async function handleSell(prizeKey: DemoRoulettePrizeKey) {
    if (isBusy || !available) return;
    setError(null);
    setNotice(null);
    setPhase("selling");

    const sale = await sellRoulettePrize(prizeKey);
    if (!sale.ok) {
      setError(sale.message);
      setPhase("idle");
      return;
    }

    setBalanceCents(sale.balanceCents);
    setInventory((current) =>
      mergeDemoRouletteInventory(current, sale.prizeKey, sale.remainingQuantity),
    );
    setNotice(`Item vendido por ${formatCoins(sale.creditedCents)} moedas.`);
    if (lastPrizeKey === sale.prizeKey && sale.remainingQuantity === 0) {
      setLastPrizeKey(null);
    }
    setPhase("idle");
  }

  const lastPrize = lastPrizeKey ? rouletteWheelPrize(prizes, lastPrizeKey) : null;

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
            {isAdmin
              ? "Modo administrador: os giros são gratuitos para testes internos."
              : "Cada moeda vale R$ 1,00 e paga um giro. Não gostou do prêmio? Venda de volta por moedas."}
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
                    aria-label="Roleta com cinco itens do catálogo"
                    className="size-full overflow-visible rounded-full will-change-transform"
                    style={{
                      transform: `rotate(${rotation}deg)`,
                      transformOrigin: "50% 50%",
                      transitionDuration: phase === "spinning" ? "2800ms" : "0ms",
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
                    {prizes.map((prize, index) => {
                      const path = wheelSegmentPath(index, prizes.length);
                      const label = wheelLabelPoint(index, prizes.length);
                      return (
                        <g key={prize.key}>
                          <path
                            d={path}
                            fill={prize.surface}
                            stroke="rgba(232,121,249,.36)"
                            strokeWidth="1.6"
                          />
                          <text
                            x={label.x}
                            y={label.y - 8}
                            textAnchor="middle"
                            fill="#fff8ff"
                            fontSize="13"
                            fontWeight="700"
                          >
                            {prize.wheelLabel}
                          </text>
                          <text
                            x={label.x}
                            y={label.y + 12}
                            textAnchor="middle"
                            fill={prize.accent}
                            fontSize="13"
                            fontWeight="800"
                          >
                            {formatCoins(prize.valueCents)}
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
                disabled={isBusy || !available || !canSpin}
                className="mx-auto mt-4 flex h-14 w-full max-w-[420px] items-center justify-center gap-3 rounded-2xl border border-fuchsia-200/55 bg-gradient-to-b from-fuchsia-500 to-[#b81780] px-6 text-base font-bold text-white shadow-[0_0_0_3px_rgba(217,70,239,.1),0_15px_40px_rgba(217,70,239,.24)] transition-[filter,transform] hover:-translate-y-0.5 hover:brightness-110 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-55 sm:text-lg"
              >
                {phase === "spinning" ? (
                  <RotateCw aria-hidden="true" className="size-5 animate-spin" />
                ) : phase === "idle" ? (
                  <RotateCw aria-hidden="true" className="size-5" />
                ) : (
                  <Loader2 aria-hidden="true" className="size-5 animate-spin" />
                )}
                {spinButtonLabel(phase, isAdmin, canSpin)}
              </button>

              {!isAdmin ? (
                <div className="mx-auto mt-4 max-w-[420px] rounded-2xl border border-amber-300/25 bg-[#140f0a]/80 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-sm font-semibold text-amber-200">
                      <Coins aria-hidden="true" className="size-4" />
                      Saldo: {formatCoins(balanceCents)} moedas
                    </span>
                    <span className="text-xs text-[#9e8a76]">
                      1 moeda = R$ 1,00 · mínimo {MINIMUM_COIN_PURCHASE}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <div className="flex h-11 items-center rounded-xl border border-amber-300/25 bg-black/25">
                      <button
                        type="button"
                        aria-label="Menos uma moeda"
                        onClick={() =>
                          setCoinQuantity((value) =>
                            Math.max(MINIMUM_COIN_PURCHASE, value - 1),
                          )
                        }
                        disabled={isBusy || coinQuantity <= MINIMUM_COIN_PURCHASE}
                        className="grid size-11 place-items-center rounded-l-xl text-amber-200 transition-colors hover:bg-amber-300/10 disabled:opacity-40"
                      >
                        <Minus aria-hidden="true" className="size-4" />
                      </button>
                      <span
                        data-testid="coin-quantity"
                        className="min-w-10 text-center text-base font-bold text-amber-100"
                      >
                        {coinQuantity}
                      </span>
                      <button
                        type="button"
                        aria-label="Mais uma moeda"
                        onClick={() =>
                          setCoinQuantity((value) => Math.min(MAXIMUM_COIN_PURCHASE, value + 1))
                        }
                        disabled={isBusy || coinQuantity >= MAXIMUM_COIN_PURCHASE}
                        className="grid size-11 place-items-center rounded-r-xl text-amber-200 transition-colors hover:bg-amber-300/10 disabled:opacity-40"
                      >
                        <Plus aria-hidden="true" className="size-4" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleBuyCoins}
                      disabled={isBusy || !available}
                      className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-amber-300/50 bg-amber-400/15 px-4 text-sm font-bold text-amber-100 transition-colors hover:bg-amber-400/25 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <QrCode aria-hidden="true" className="size-4" />
                      {phase === "preparing"
                        ? "Gerando o Pix..."
                        : `Comprar por R$ ${coinQuantity},00`}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-center text-xs leading-5 text-[#8f7a98]">
                  Giro de teste interno: nenhuma moeda é gasta.
                </p>
              )}

              {phase === "awaiting_payment" ? (
                <div
                  role="status"
                  className="mx-auto mt-4 max-w-[420px] rounded-2xl border border-fuchsia-300/25 bg-[#140b1a]/90 p-4 text-center"
                >
                  <p className="flex items-center justify-center gap-2 text-sm font-semibold text-fuchsia-200">
                    <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                    Aguardando a confirmação do Pix
                  </p>
                  <p className="mt-2 text-xs leading-5 text-[#9e88a8]">
                    As moedas caem no seu saldo assim que a LivePix confirmar.
                  </p>
                  {checkoutUrl ? (
                    <a
                      href={checkoutUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-fuchsia-200/50 bg-fuchsia-500/15 px-4 text-sm font-semibold text-fuchsia-100 transition-colors hover:bg-fuchsia-500/25"
                    >
                      <QrCode aria-hidden="true" className="size-4" />
                      Abrir o Pix
                    </a>
                  ) : null}
                </div>
              ) : null}

              {!available ? (
                <p
                  role="alert"
                  className="mx-auto mt-4 max-w-md rounded-xl border border-amber-300/25 bg-amber-300/[0.07] px-4 py-3 text-center text-sm text-amber-100"
                >
                  O inventário está temporariamente indisponível.
                </p>
              ) : null}
              {error ? (
                <p
                  role="alert"
                  className="mx-auto mt-4 max-w-md rounded-xl border border-rose-400/25 bg-rose-400/[0.08] px-4 py-3 text-center text-sm text-rose-200"
                >
                  {error}
                </p>
              ) : null}
              {notice ? (
                <p
                  role="status"
                  className="mx-auto mt-4 max-w-md rounded-xl border border-emerald-400/25 bg-emerald-400/[0.08] px-4 py-3 text-center text-sm text-emerald-200"
                >
                  {notice}
                </p>
              ) : null}
            </div>

            <div
              aria-live="polite"
              className="mx-auto w-full max-w-sm text-center xl:text-left"
            >
              {lastPrize ? (
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
                    {lastPrize.displayName}
                  </p>
                  <p className="relative mt-1 text-sm font-semibold text-amber-200">
                    vale {formatCoins(lastPrize.valueCents)} moedas
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
                const prize = rouletteWheelPrize(prizes, item.prizeKey);
                const Icon = PRIZE_ICONS[item.prizeKey];
                return (
                  <li
                    key={item.prizeKey}
                    className="overflow-hidden rounded-2xl border border-fuchsia-300/20 bg-[#100a15]/90 p-3.5 shadow-[inset_0_1px_rgba(255,255,255,.025)]"
                  >
                    <div className="grid grid-cols-[52px_1fr_auto] items-center gap-4">
                      <span
                        className="grid size-[52px] place-items-center overflow-hidden rounded-xl border bg-black/20"
                        style={{
                          borderColor: `${prize.accent}55`,
                          color: prize.accent,
                          backgroundColor: `${prize.surface}cc`,
                        }}
                      >
                        {prize.imageUrl ? (
                          <img src={prize.imageUrl} alt="" className="size-full object-cover" />
                        ) : (
                          <Icon aria-hidden="true" className="size-5" strokeWidth={1.8} />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-[#fbf8fc]">
                          {prize.displayName}
                        </span>
                        <span className="mt-0.5 block text-xs text-[#9e8a76]">
                          vale {formatCoins(prize.valueCents)} moedas
                        </span>
                      </span>
                      <span
                        className="min-w-10 border-l border-fuchsia-300/15 pl-4 text-center text-xl font-bold"
                        style={{ color: prize.accent }}
                        aria-label={`Quantidade: ${item.quantity}`}
                      >
                        {item.quantity}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSell(item.prizeKey)}
                      disabled={isBusy || !available || prize.saleValueCents <= 0}
                      className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-amber-300/35 bg-amber-400/10 px-3 text-xs font-bold text-amber-100 transition-colors hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Coins aria-hidden="true" className="size-3.5" />
                      {prize.saleValueCents > 0
                        ? `Vender 1 por ${formatCoins(prize.saleValueCents)} moedas`
                        : "Sem valor de recompra"}
                    </button>
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
                  Gire a roleta para receber seu primeiro prêmio.
                </p>
              </div>
            </div>
          )}

          <div className="mt-5 flex gap-3 border-t border-fuchsia-300/10 pt-5 text-xs leading-5 text-[#87728f]">
            <ShieldCheck
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-fuchsia-300/55"
            />
            <p>
              Os cinco itens são uma seleção provisória do catálogo para testes. Vender devolve
              parte do valor em moedas; a entrega dos prêmios ainda será liberada em uma
              próxima etapa.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}

function spinButtonLabel(phase: Phase, isAdmin: boolean, canSpin: boolean) {
  if (phase === "spinning") return "Girando...";
  if (phase === "preparing") return "Gerando o Pix...";
  if (phase === "awaiting_payment") return "Aguardando o Pix...";
  if (phase === "selling") return "Vendendo...";
  if (isAdmin) return "Girar grátis (admin)";
  return canSpin ? "Girar (1 moeda)" : "Sem moedas suficientes";
}

function wheelSegmentPath(index: number, total: number) {
  const segmentAngle = 360 / total;
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

function wheelLabelPoint(index: number, total: number) {
  const segmentAngle = 360 / total;
  return polarPoint(index * segmentAngle - 90 + segmentAngle / 2, 105);
}

function polarPoint(angle: number, radius = WHEEL_RADIUS) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: WHEEL_CENTER + Math.cos(radians) * radius,
    y: WHEEL_CENTER + Math.sin(radians) * radius,
  };
}
