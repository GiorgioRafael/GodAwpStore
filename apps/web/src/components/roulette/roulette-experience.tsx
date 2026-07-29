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
  PackageCheck,
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
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getRouletteCoinPurchaseStatus,
  redeemRoulettePrizes,
  sellRoulettePrizes,
  spinRoulette,
  startRouletteCoinPurchase,
  type RouletteSelection,
  type RouletteSettledLine,
} from "@/app/roleta/actions";
import { BrandMark } from "@/components/layout/brand-mark";
import { RouletteConfetti } from "@/components/roulette/roulette-celebration";
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
import {
  EXTRA_TURNS,
  highlightedPrizeValues,
  spinWheelTo,
  wheelLabelPoint,
  wheelSegmentPath,
  WHEEL_CENTER,
  WHEEL_RADIUS,
  WHEEL_SIZE,
} from "@/lib/roulette/wheel";

const PRIZE_ICONS: Record<DemoRoulettePrizeKey, LucideIcon> = {
  premio_1: Gift,
  premio_2: Star,
  premio_3: Zap,
  premio_4: Gem,
  premio_5: Crown,
};

const PAYMENT_POLL_INTERVAL_MS = 4_000;
const SPIN_MS = 4_400;

type Phase =
  | "idle"
  | "preparing"
  | "awaiting_payment"
  | "spinning"
  | "selling"
  | "redeeming";

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
  const [landed, setLanded] = useState(false);
  const [phase, setPhase] = useState<Phase>(initialPurchaseId ? "awaiting_payment" : "idle");
  const [purchaseId, setPurchaseId] = useState<string | null>(initialPurchaseId);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [coinQuantity, setCoinQuantity] = useState(MINIMUM_COIN_PURCHASE);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [buyOpen, setBuyOpen] = useState(false);
  const router = useRouter();
  const rotationRef = useRef(0);
  const wheelRef = useRef<SVGGElement | null>(null);
  const phaseRef = useRef(phase);
  const totalPrizes = inventory.reduce((total, item) => total + item.quantity, 0);
  const isBusy = phase !== "idle";
  const canSpin = isAdmin || balanceCents >= SPIN_COST_CENTS;
  const selection: RouletteSelection[] = inventory.flatMap((item) => {
    const quantity = Math.min(selected[item.prizeKey] ?? 0, item.quantity);
    return quantity > 0 ? [{ prizeKey: item.prizeKey, quantity }] : [];
  });
  const selectedUnits = selection.reduce((total, line) => total + line.quantity, 0);
  const selectedSaleCents = selection.reduce(
    (total, line) => total + rouletteWheelPrize(prizes, line.prizeKey).saleValueCents * line.quantity,
    0,
  );
  const hasSelection = selection.length > 0;

  function toggleSelected(prizeKey: DemoRoulettePrizeKey, quantity: number) {
    setSelected((current) => {
      const next = { ...current };
      if (quantity <= 0) delete next[prizeKey];
      else next[prizeKey] = quantity;
      return next;
    });
  }

  function applySettledLines(lines: RouletteSettledLine[]) {
    setInventory((current) =>
      lines.reduce(
        (inv, line) => mergeDemoRouletteInventory(inv, line.prizeKey, line.remainingQuantity),
        current,
      ),
    );
    setSelected({});
  }

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
    router.refresh();
    setLanded(false);

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const from = rotationRef.current;
    const to = demoRouletteRotation(from, result.prizeKey) + EXTRA_TURNS * 360;
    rotationRef.current = await spinWheelTo(
      wheelRef.current,
      from,
      to,
      reduceMotion ? 80 : SPIN_MS,
    );

    setInventory((current) =>
      mergeDemoRouletteInventory(current, result.prizeKey, result.inventoryQuantity),
    );
    setLastPrizeKey(result.prizeKey);
    setLanded(true);
    setPhase("idle");
  }, [router]);

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
      router.refresh();
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
  }, [purchaseId, phase, router]);

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

  async function handleSell() {
    if (isBusy || !available || !hasSelection) return;
    setError(null);
    setNotice(null);
    setPhase("selling");

    const sale = await sellRoulettePrizes(selection);
    if (!sale.ok) {
      setError(sale.message);
      setPhase("idle");
      return;
    }

    setBalanceCents(sale.balanceCents);
    router.refresh();
    applySettledLines(sale.lines);
    setNotice(
      `${sale.itemCount} ${sale.itemCount === 1 ? "item vendido" : "itens vendidos"} por ${formatCoins(sale.creditedCents)} moedas.`,
    );
    setLastPrizeKey(null);
    setPhase("idle");
  }

  async function handleRedeem() {
    if (isBusy || !available || !hasSelection) return;
    setError(null);
    setNotice(null);
    setPhase("redeeming");

    const redemption = await redeemRoulettePrizes(selection);
    if (!redemption.ok) {
      setError(redemption.message);
      setPhase("idle");
      return;
    }

    applySettledLines(redemption.lines);
    const names = redemption.productNames.join(", ");
    setNotice(
      redemption.ticketOpened
        ? `Resgate aberto (${names}). Um ticket privado foi criado no Discord para a entrega.`
        : `Resgate de ${names} registrado. O ticket no Discord será aberto em instantes.`,
    );
    setLastPrizeKey(null);
    setPhase("idle");
  }

  const lastPrize = lastPrizeKey ? rouletteWheelPrize(prizes, lastPrizeKey) : null;
  const topPrizeCents = prizes.reduce((top, prize) => Math.max(top, prize.valueCents), 0);
  const highlighted = useMemo(
    () => highlightedPrizeValues(prizes.map((prize) => prize.valueCents)),
    [prizes],
  );
  const bigPrize = Boolean(lastPrize && highlighted.has(lastPrize.valueCents));
  const topPrize = Boolean(lastPrize && lastPrize.valueCents >= topPrizeCents && topPrizeCents > 0);
  const celebrating = landed && bigPrize;

  return (
    <main className="relative min-h-[calc(100vh-76px)] overflow-hidden bg-[#050306] text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_28%_22%,rgba(217,70,239,.11),transparent_32%),radial-gradient(circle_at_84%_78%,rgba(126,34,206,.08),transparent_30%)]"
      />
      <div className="sticky top-0 z-30 border-b border-amber-300/20 bg-[#0b0705]/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-4 py-3 sm:px-6 lg:px-10">
          <span className="flex items-center gap-2 text-sm text-[#c8b49a]">
            <Coins aria-hidden="true" className="size-4 text-amber-300" />
            <span className="hidden sm:inline">Saldo</span>
          </span>
          <strong
            data-testid="roulette-balance"
            className="text-xl font-black tracking-[-0.02em] text-amber-100"
          >
            {formatCoins(balanceCents)}
          </strong>
          <span className="hidden text-sm text-[#9e8a76] sm:inline">moedas</span>
          <button
            type="button"
            onClick={() => setBuyOpen((open) => !open)}
            aria-expanded={buyOpen}
            aria-label="Adicionar moedas"
            className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-xl border border-amber-300/55 bg-amber-400/20 px-3.5 text-sm font-bold text-amber-100 transition-colors hover:bg-amber-400/30 sm:px-4"
          >
            <Plus aria-hidden="true" className="size-4" />
            <span className="hidden sm:inline">Adicionar moedas</span>
            <span className="sm:hidden">Moedas</span>
          </button>
          <a
            href="#inventario"
            aria-label={`Inventário: ${totalPrizes} ${totalPrizes === 1 ? "prêmio" : "prêmios"}`}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-fuchsia-300/35 bg-fuchsia-400/10 px-3 text-sm font-bold text-fuchsia-100 transition-colors hover:bg-fuchsia-400/20"
          >
            <Box aria-hidden="true" className="size-4" />
            {totalPrizes}
          </a>
        </div>

        {buyOpen ? (
          <div className="border-t border-amber-300/15 bg-[#140f0a]/95">
            <div className="mx-auto max-w-[1440px] px-4 py-4 sm:px-6 lg:px-10">
              <div className="mx-auto flex max-w-[560px] flex-col gap-3">
                <p className="text-sm text-[#c8b49a]">
                  Cada moeda custa <strong className="text-amber-100">R$ 1,00</strong> e paga um
                  giro. O Pix cai no seu saldo automaticamente.
                </p>
                <div className="flex items-center gap-2">
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
                    className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-amber-300/55 bg-amber-400/20 px-4 text-sm font-bold text-amber-100 transition-colors hover:bg-amber-400/30 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <QrCode aria-hidden="true" className="size-4" />
                    {phase === "preparing"
                      ? "Gerando o Pix..."
                      : `Comprar por R$ ${coinQuantity},00`}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[1, 5, 10, 25].map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => setCoinQuantity(amount)}
                      disabled={isBusy}
                      className={`h-8 rounded-lg border px-3 text-xs font-bold transition-colors disabled:opacity-40 ${
                        coinQuantity === amount
                          ? "border-amber-300/60 bg-amber-400/25 text-amber-100"
                          : "border-amber-300/20 text-[#c8b49a] hover:bg-amber-300/10"
                      }`}
                    >
                      {amount} {amount === 1 ? "moeda" : "moedas"}
                    </button>
                  ))}
                </div>
                {isAdmin ? (
                  <p className="rounded-lg border border-fuchsia-300/25 bg-fuchsia-400/10 px-3 py-2 text-xs font-semibold text-fuchsia-200">
                    Modo administrador: o giro é grátis, mas a venda de itens credita moedas de
                    verdade nesta conta.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

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

          <div className="mt-7 [@media(max-height:820px)]:mt-4">
            <div className="mx-auto w-full max-w-[560px]">
              <div className="relative mx-auto aspect-square w-full max-w-[520px] [@media(max-height:820px)]:max-w-[400px]">
                {celebrating ? <RouletteConfetti gold={topPrize} /> : null}
                <div
                  aria-hidden="true"
                  className={`absolute inset-[3%] rounded-full blur-3xl transition-colors duration-500 ${
                    celebrating
                      ? topPrize
                        ? "bg-amber-400/30"
                        : "bg-emerald-400/25"
                      : "bg-fuchsia-500/10"
                  }`}
                />
                <span
                  aria-hidden="true"
                  className="absolute left-1/2 top-[-1px] z-20 h-0 w-0 -translate-x-1/2 drop-shadow-[0_0_12px_rgba(244,114,182,.95)]"
                  style={{
                    borderLeft: "clamp(18px, 4vw, 22px) solid transparent",
                    borderRight: "clamp(18px, 4vw, 22px) solid transparent",
                    borderTop: `clamp(32px, 6vw, 39px) solid ${
                      celebrating ? (topPrize ? "#fbbf24" : "#34d399") : "#e879f9"
                    }`,
                  }}
                />
                <div className="absolute inset-[5.5%] rounded-full border border-fuchsia-200/35 bg-[#0b0710] p-[2.2%] shadow-[0_0_0_5px_rgba(217,70,239,.06),0_0_54px_rgba(217,70,239,.24),inset_0_0_28px_rgba(217,70,239,.12)]">
                  <svg
                    viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`}
                    role="img"
                    aria-label="Roleta com cinco itens do catálogo"
                    className="size-full overflow-visible rounded-full"
                  >
                    <defs>
                      {prizes.map((prize, index) => (
                        <linearGradient
                          key={prize.key}
                          id={`site-slot-${index}`}
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop offset="0%" stopColor={prize.accent} stopOpacity="0.45" />
                          <stop offset="100%" stopColor={prize.surface} stopOpacity="1" />
                        </linearGradient>
                      ))}
                      <filter id="site-glow" x="-40%" y="-40%" width="180%" height="180%">
                        <feGaussianBlur stdDeviation="3" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
                    <circle
                      cx={WHEEL_CENTER}
                      cy={WHEEL_CENTER}
                      r={WHEEL_RADIUS + 10}
                      fill="#08040c"
                      stroke="rgba(244,114,182,.72)"
                      strokeWidth="3"
                    />
                    <g ref={wheelRef} style={{ transformOrigin: "50% 50%" }}>
                      {prizes.map((prize, index) => {
                        const label = wheelLabelPoint(index, prizes.length);
                        const highlight = highlighted.has(prize.valueCents);
                        return (
                          <g key={prize.key}>
                            <path
                              d={wheelSegmentPath(index, prizes.length)}
                              fill={`url(#site-slot-${index})`}
                              stroke={highlight ? "#fde68a" : "rgba(232,121,249,.36)"}
                              strokeWidth={highlight ? 3 : 1.6}
                              filter={highlight ? "url(#site-glow)" : undefined}
                            />
                            <text
                              x={label.x}
                              y={label.y - 7}
                              textAnchor="middle"
                              fill="#fff8ff"
                              fontSize="13"
                              fontWeight="800"
                              style={{
                                paintOrder: "stroke",
                                stroke: "rgba(0,0,0,.55)",
                                strokeWidth: 3,
                              }}
                            >
                              {prize.wheelLabel}
                            </text>
                            <text
                              x={label.x}
                              y={label.y + 13}
                              textAnchor="middle"
                              fill={highlight ? "#fde68a" : prize.accent}
                              fontSize={highlight ? 15 : 13}
                              fontWeight="900"
                              style={{
                                paintOrder: "stroke",
                                stroke: "rgba(0,0,0,.6)",
                                strokeWidth: 3,
                              }}
                            >
                              {formatCoins(prize.valueCents)}
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  </svg>
                  <span className="absolute left-1/2 top-1/2 grid size-[25%] -translate-x-1/2 -translate-y-1/2 place-items-center overflow-hidden rounded-full border-2 border-fuchsia-200/55 bg-[#08040c] p-[8px] shadow-[0_0_25px_rgba(217,70,239,.42)]">
                    <BrandMark className="rounded-full" />
                  </span>
                </div>

                <div
                  aria-live="polite"
                  className="pointer-events-none absolute inset-x-0 bottom-[6%] z-30 flex justify-center px-4"
                >
                  {lastPrize ? (
                    <div
                      className={`animate-[popIn_.45s_cubic-bezier(.2,1.4,.4,1)] max-w-full rounded-3xl border-2 px-6 py-4 text-center shadow-[0_18px_55px_rgba(0,0,0,.65)] backdrop-blur ${
                        topPrize
                          ? "border-amber-300 bg-gradient-to-b from-[#2c1f04]/95 to-[#160f02]/95"
                          : bigPrize
                            ? "border-emerald-300/70 bg-gradient-to-b from-[#062018]/95 to-[#03120d]/95"
                            : "border-fuchsia-300/55 bg-gradient-to-b from-[#1d0f26]/95 to-[#0f0714]/95"
                      }`}
                    >
                      <p
                        className={`flex items-center justify-center gap-1.5 text-xs font-black uppercase tracking-[0.2em] ${
                          topPrize
                            ? "text-amber-300"
                            : bigPrize
                              ? "text-emerald-300"
                              : "text-fuchsia-300"
                        }`}
                      >
                        <Sparkles aria-hidden="true" className="size-3.5" />
                        {topPrize ? "Prêmio máximo" : bigPrize ? "Prêmio raro" : "Você ganhou"}
                      </p>
                      <p
                        data-testid="roulette-result"
                        className="mt-1 truncate text-2xl font-black tracking-[-0.03em] text-white sm:text-3xl"
                      >
                        {lastPrize.displayName}
                      </p>
                      <p
                        className={`mt-1.5 inline-block rounded-full px-3 py-0.5 text-sm font-black ${
                          topPrize
                            ? "bg-amber-400/25 text-amber-200"
                            : bigPrize
                              ? "bg-emerald-400/20 text-emerald-200"
                              : "bg-fuchsia-400/20 text-fuchsia-200"
                        }`}
                      >
                        {formatCoins(lastPrize.valueCents)} moedas
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>

              <button
                type="button"
                onClick={canSpin ? handleSpin : () => setBuyOpen(true)}
                disabled={isBusy || !available}
                className="mx-auto mt-4 flex h-14 w-full max-w-[420px] items-center justify-center gap-3 rounded-2xl border border-fuchsia-200/55 bg-gradient-to-b from-fuchsia-500 to-[#b81780] px-6 text-base font-bold text-white shadow-[0_0_0_3px_rgba(217,70,239,.1),0_15px_40px_rgba(217,70,239,.24)] transition-[filter,transform] hover:-translate-y-0.5 hover:brightness-110 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-55 sm:text-lg"
              >
                {phase === "spinning" ? (
                  <RotateCw aria-hidden="true" className="size-5 animate-spin" />
                ) : phase !== "idle" ? (
                  <Loader2 aria-hidden="true" className="size-5 animate-spin" />
                ) : canSpin ? (
                  <RotateCw aria-hidden="true" className="size-5" />
                ) : (
                  <Plus aria-hidden="true" className="size-5" />
                )}
                {spinButtonLabel(phase, isAdmin, canSpin)}
              </button>


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
                const picked = Math.min(selected[item.prizeKey] ?? 0, item.quantity);
                return (
                  <li
                    key={item.prizeKey}
                    className={`overflow-hidden rounded-2xl border p-3.5 shadow-[inset_0_1px_rgba(255,255,255,.025)] transition-colors ${
                      picked > 0
                        ? "border-amber-300/50 bg-[#191207]/90"
                        : "border-fuchsia-300/20 bg-[#100a15]/90"
                    }`}
                  >
                    <div className="grid grid-cols-[auto_52px_1fr_auto] items-center gap-3">
                      <input
                        type="checkbox"
                        checked={picked > 0}
                        onChange={(event) =>
                          toggleSelected(item.prizeKey, event.target.checked ? 1 : 0)
                        }
                        disabled={isBusy || !available}
                        aria-label={`Selecionar ${prize.displayName}`}
                        className="size-4 accent-amber-400"
                      />
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
                        className="min-w-10 border-l border-fuchsia-300/15 pl-3 text-center text-xl font-bold"
                        style={{ color: prize.accent }}
                        aria-label={`Quantidade: ${item.quantity}`}
                      >
                        {item.quantity}
                      </span>
                    </div>
                    {picked > 0 && item.quantity > 1 ? (
                      <div className="mt-2.5 flex items-center justify-end gap-2 text-xs text-[#c8b49a]">
                        <span>Quantidade:</span>
                        <button
                          type="button"
                          aria-label={`Menos um ${prize.displayName}`}
                          onClick={() => toggleSelected(item.prizeKey, picked - 1)}
                          disabled={isBusy || picked <= 1}
                          className="grid size-7 place-items-center rounded-lg border border-amber-300/30 text-amber-200 disabled:opacity-40"
                        >
                          <Minus aria-hidden="true" className="size-3" />
                        </button>
                        <span className="min-w-6 text-center font-bold text-amber-100">
                          {picked}
                        </span>
                        <button
                          type="button"
                          aria-label={`Mais um ${prize.displayName}`}
                          onClick={() => toggleSelected(item.prizeKey, picked + 1)}
                          disabled={isBusy || picked >= item.quantity}
                          className="grid size-7 place-items-center rounded-lg border border-amber-300/30 text-amber-200 disabled:opacity-40"
                        >
                          <Plus aria-hidden="true" className="size-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleSelected(item.prizeKey, item.quantity)}
                          disabled={isBusy || picked >= item.quantity}
                          className="rounded-lg border border-amber-300/30 px-2 py-1 font-semibold text-amber-200 disabled:opacity-40"
                        >
                          Tudo
                        </button>
                      </div>
                    ) : null}
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

          {inventory.length ? (
            <div className="sticky bottom-3 mt-5 rounded-2xl border border-amber-300/30 bg-[#161008]/95 p-3.5 backdrop-blur">
              <p className="text-xs text-[#c8b49a]">
                {hasSelection
                  ? `${selectedUnits} ${selectedUnits === 1 ? "item selecionado" : "itens selecionados"} · venda rende ${formatCoins(selectedSaleCents)} moedas`
                  : "Marque os itens que quer vender ou resgatar"}
              </p>
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleSell}
                  disabled={isBusy || !available || !hasSelection || selectedSaleCents <= 0}
                  className="flex h-11 items-center justify-center gap-2 rounded-xl border border-amber-300/45 bg-amber-400/15 px-3 text-sm font-bold text-amber-100 transition-colors hover:bg-amber-400/25 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Coins aria-hidden="true" className="size-4 shrink-0" />
                  {phase === "selling" ? "Vendendo..." : "Vender selecionados"}
                </button>
                <button
                  type="button"
                  onClick={handleRedeem}
                  disabled={isBusy || !available || !hasSelection}
                  className="flex h-11 items-center justify-center gap-2 rounded-xl border border-emerald-300/45 bg-emerald-400/15 px-3 text-sm font-bold text-emerald-100 transition-colors hover:bg-emerald-400/25 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <PackageCheck aria-hidden="true" className="size-4 shrink-0" />
                  {phase === "redeeming" ? "Resgatando..." : "Resgatar selecionados"}
                </button>
              </div>
            </div>
          ) : null}

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
  if (phase === "redeeming") return "Resgatando...";
  if (isAdmin) return "Girar grátis (admin)";
  // Sem saldo o botão não vira beco sem saída: ele abre a compra de moedas.
  return canSpin ? "Girar (1 moeda)" : "Adicionar moedas para girar";
}
