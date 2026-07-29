"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { readRouletteOverlayEvents } from "@/app/roleta/overlay/actions";
import { BrandMark } from "@/components/layout/brand-mark";
import { RouletteConfetti } from "@/components/roulette/roulette-celebration";
import {
  demoRouletteRotation,
  formatCoins,
  isDemoRoulettePrizeKey,
  rouletteWheelPrize,
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

const DEFAULT_SPIN_MS = 4_600;
const DEFAULT_RESULT_MS = 3_400;
const POLL_MS = 1_500;
const IDLE_TURN_MS = 44_000;
/** Entrada e saída do card do ganhador. */
const FADE_MS = 420;

export type RouletteOverlayEvent = {
  id: string;
  prizeKey: DemoRoulettePrizeKey;
  productName: string;
  valueCents: number;
  maskedDisplayName: string;
  isTopPrize: boolean;
};

/**
 * Live overlay for OBS. It replays spins one at a time from the public masked
 * feed. When the backlog is longer than `queueLimit` the extra spins are only
 * counted, so the stream never falls minutes behind — except for the biggest
 * prize, which always gets its animation.
 */
export function RouletteOverlay({
  prizes,
  token,
  queueLimit = 8,
  spinMs = DEFAULT_SPIN_MS,
  resultMs = DEFAULT_RESULT_MS,
  pollMs = POLL_MS,
}: {
  prizes: RouletteWheelPrize[];
  token: string;
  queueLimit?: number;
  /** Animation and polling timings, shortened by the tests. */
  spinMs?: number;
  resultMs?: number;
  pollMs?: number;
}) {
  const [current, setCurrent] = useState<RouletteOverlayEvent | null>(null);
  const [landed, setLanded] = useState(false);
  const [cardVisible, setCardVisible] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const [connected, setConnected] = useState(false);
  const queue = useRef<RouletteOverlayEvent[]>([]);
  const rotationRef = useRef(0);
  const busy = useRef(false);
  const seen = useRef(new Set<string>());
  const wheelRef = useRef<SVGGElement | null>(null);
  const idleRef = useRef<Animation | null>(null);

  useEffect(() => {
    let active = true;
    let since: string | null = null;

    /** Slow drift so the overlay is never a frozen picture on stream. */
    function startIdle() {
      const wheel = wheelRef.current;
      if (!wheel?.animate || idleRef.current) return;
      idleRef.current = wheel.animate(
        [
          { transform: `rotate(${rotationRef.current}deg)` },
          { transform: `rotate(${rotationRef.current + 360}deg)` },
        ],
        { duration: IDLE_TURN_MS, iterations: Infinity, easing: "linear" },
      );
    }

    function stopIdle() {
      idleRef.current?.cancel();
      idleRef.current = null;
    }

    async function play() {
      if (busy.current || !active) return;
      const next = queue.current.shift();
      if (!next) return;
      busy.current = true;

      setLanded(false);
      stopIdle();
      const from = rotationRef.current;
      const to = demoRouletteRotation(from, next.prizeKey, prizes) + EXTRA_TURNS * 360;
      rotationRef.current = await spinWheelTo(wheelRef.current, from, to, spinMs);
      if (!active) return;

      setCurrent(next);
      setLanded(true);
      setCardVisible(true);
      await wait(resultMs);
      if (!active) return;

      // Sai desenhado: o card apaga antes de deixar de existir.
      setCardVisible(false);
      await wait(FADE_MS);
      if (!active) return;

      setCurrent(null);
      setLanded(false);
      busy.current = false;
      startIdle();
      void play();
    }

    function enqueue(event: RouletteOverlayEvent) {
      if (seen.current.has(event.id)) return;
      seen.current.add(event.id);

      // The jackpot always earns its animation, however long the backlog is.
      if (event.isTopPrize) {
        queue.current.unshift(event);
      } else if (queue.current.length < queueLimit) {
        queue.current.push(event);
      } else {
        setSkipped((value) => value + 1);
        return;
      }
      void play();
    }

    async function poll() {
      try {
        const feed = await readRouletteOverlayEvents(token, since);
        if (!active) return;
        setConnected(true);
        // The server owns the cursor, so an empty round still moves it forward
        // and a spin landing between two polls is never skipped.
        since = feed.cursor;
        for (const raw of feed.events) {
          const event = readEvent(raw);
          if (event) enqueue(event);
        }
      } catch {
        if (active) setConnected(false);
      }
    }

    startIdle();
    void poll();
    const timer = window.setInterval(() => void poll(), pollMs);

    return () => {
      active = false;
      window.clearInterval(timer);
      stopIdle();
    };
  }, [queueLimit, spinMs, resultMs, pollMs, token, prizes]);

  const prize = current ? rouletteWheelPrize(prizes, current.prizeKey) : null;
  const jackpot = Boolean(current?.isTopPrize);
  const highlighted = useMemo(
    () => highlightedPrizeValues(prizes.map((prize) => prize.valueCents)),
    [prizes],
  );
  const big = Boolean(current && highlighted.has(current.valueCents));
  const celebrating = landed && big;

  return (
    <div className="relative flex h-screen w-full flex-col items-center justify-center overflow-hidden bg-transparent p-[3vh]">
      {celebrating ? <RouletteConfetti gold={jackpot} /> : null}

      <div
        className={`@container relative aspect-square w-[min(52vh,440px)] shrink-0 transition-transform duration-500 ${
          celebrating ? "scale-[1.03]" : "scale-100"
        }`}
      >
        <div
          aria-hidden="true"
          className={`absolute inset-[-8%] rounded-full blur-3xl transition-colors duration-500 ${
            celebrating
              ? jackpot
                ? "bg-amber-400/40"
                : "bg-emerald-400/30"
              : "bg-fuchsia-500/20"
          }`}
        />

        <span
          aria-hidden="true"
          className="absolute left-1/2 top-[-6px] z-30 h-0 w-0 -translate-x-1/2 drop-shadow-[0_0_18px_rgba(244,114,182,1)]"
          style={{
            borderLeft: "20px solid transparent",
            borderRight: "20px solid transparent",
            borderTop: `38px solid ${celebrating ? (jackpot ? "#fbbf24" : "#34d399") : "#e879f9"}`,
          }}
        />

        <svg
          viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`}
          role="img"
          aria-label="Roleta da GWStore"
          className="size-full overflow-visible"
        >
          <defs>
            {prizes.map((slot, index) => (
              <linearGradient key={slot.key} id={`ov-slot-${index}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={slot.accent} stopOpacity="0.45" />
                <stop offset="100%" stopColor={slot.surface} stopOpacity="1" />
              </linearGradient>
            ))}
            <radialGradient id="ov-hub" cx="50%" cy="35%">
              <stop offset="0%" stopColor="#2a0f36" />
              <stop offset="100%" stopColor="#08040c" />
            </radialGradient>
            <filter id="ov-glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <circle
            cx={WHEEL_CENTER}
            cy={WHEEL_CENTER}
            r={WHEEL_RADIUS + 16}
            fill="none"
            stroke={celebrating ? "rgba(251,191,36,.9)" : "rgba(244,114,182,.55)"}
            strokeWidth="4"
          />
          <circle
            cx={WHEEL_CENTER}
            cy={WHEEL_CENTER}
            r={WHEEL_RADIUS + 9}
            fill="none"
            stroke={celebrating ? "rgba(251,191,36,.65)" : "rgba(232,121,249,.45)"}
            strokeWidth="3"
            strokeDasharray="2 12"
            strokeLinecap="round"
          />

          <g ref={wheelRef} style={{ transformOrigin: "50% 50%" }}>
            {prizes.map((slot, index) => {
              const label = wheelLabelPoint(index, prizes.length);
              const highlight = highlighted.has(slot.valueCents);
              return (
                <g key={slot.key}>
                  <path
                    d={wheelSegmentPath(index, prizes.length)}
                    fill={`url(#ov-slot-${index})`}
                    stroke={highlight ? "#fde68a" : "rgba(255,255,255,.16)"}
                    strokeWidth={highlight ? 3 : 1.5}
                    filter={highlight ? "url(#ov-glow)" : undefined}
                  />
                  <text
                    x={label.x}
                    y={label.y - 7}
                    textAnchor="middle"
                    fill="#fff8ff"
                    fontSize="14"
                    fontWeight="800"
                    style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,.6)", strokeWidth: 3.5 }}
                  >
                    {slot.wheelLabel}
                  </text>
                  <text
                    x={label.x}
                    y={label.y + 14}
                    textAnchor="middle"
                    fill={highlight ? "#fde68a" : slot.accent}
                    fontSize={highlight ? 17 : 14}
                    fontWeight="900"
                    style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,.65)", strokeWidth: 3.5 }}
                  >
                    {formatCoins(slot.valueCents)}
                  </text>
                </g>
              );
            })}
          </g>

          <circle cx={WHEEL_CENTER} cy={WHEEL_CENTER} r="50" fill="url(#ov-hub)" />
          <circle
            cx={WHEEL_CENTER}
            cy={WHEEL_CENTER}
            r="50"
            fill="none"
            stroke={celebrating ? "rgba(251,191,36,.95)" : "rgba(244,114,182,.75)"}
            strokeWidth="3"
          />
        </svg>

        <span
          className={`pointer-events-none absolute left-1/2 top-1/2 grid size-[25%] -translate-x-1/2 -translate-y-1/2 place-items-center overflow-hidden rounded-full transition-opacity duration-300 ${
            prize && current && cardVisible ? "opacity-0" : "opacity-100"
          }`}
        >
          <BrandMark className="rounded-full" />
        </span>

        {/* No miolo da roda. Sobreposto e fora do fluxo, então aparecer e sumir
            não move nada — que era o motivo de a altura ficar reservada quando
            o card vivia embaixo. */}
        <div
          aria-live="polite"
          className="pointer-events-none absolute inset-0 z-20 grid place-items-center p-[9%]"
        >
          {prize && current ? (
            <div
              data-testid="overlay-result"
              style={{ transitionDuration: `${FADE_MS}ms` }}
              className={`w-full rounded-[8cqw] border-2 px-[6cqw] py-[5cqw] text-center shadow-[0_24px_70px_rgba(0,0,0,.7)] backdrop-blur-md transition-all ease-out ${
                cardVisible ? "scale-100 opacity-100" : "scale-90 opacity-0"
              } ${
                jackpot
                  ? "border-amber-300 bg-gradient-to-b from-[#2c1f04]/95 to-[#160f02]/95"
                  : big
                    ? "border-emerald-300/70 bg-gradient-to-b from-[#062018]/95 to-[#03120d]/95"
                    : "border-fuchsia-300/60 bg-gradient-to-b from-[#1d0f26]/95 to-[#0f0714]/95"
              }`}
            >
              {jackpot ? (
                <p className="mb-[1cqw] text-[3.2cqw] font-black uppercase tracking-[0.26em] text-amber-300">
                  ★ Prêmio máximo ★
                </p>
              ) : big ? (
                <p className="mb-[1cqw] text-[3.2cqw] font-black uppercase tracking-[0.2em] text-emerald-300">
                  Prêmio raro
                </p>
              ) : null}
              <p className="text-[4.6cqw] font-bold leading-tight text-white">
                <span
                  className={jackpot ? "text-amber-300" : big ? "text-emerald-300" : "text-fuchsia-300"}
                >
                  {current.maskedDisplayName}
                </span>{" "}
                ganhou
              </p>
              {/* Duas linhas em vez de cortar: o card agora tem a largura da
                  roda, e um nome de pacote como "10x Super Watering Can" some
                  quase inteiro numa linha só. */}
              <p className="mt-[1cqw] line-clamp-2 text-balance break-words text-[7cqw] font-black leading-[1.05] tracking-[-0.035em] text-white">
                {prize.displayName}
              </p>
              <p
                className={`mt-[2cqw] inline-block rounded-full px-[3.5cqw] py-[1cqw] text-[4.2cqw] font-black ${
                  jackpot
                    ? "bg-amber-400/25 text-amber-200"
                    : big
                      ? "bg-emerald-400/20 text-emerald-200"
                      : "bg-fuchsia-400/20 text-fuchsia-200"
                }`}
              >
                {formatCoins(current.valueCents)} moedas
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Fora do fluxo, senão aparecer ou sumir também empurra a roda. */}
      {skipped > 0 ? (
        <p
          data-testid="overlay-skipped"
          className="absolute bottom-[3vh] left-1/2 -translate-x-1/2 rounded-full border border-white/15 bg-black/50 px-4 py-1 text-[1.6vh] font-semibold text-white/80"
        >
          +{skipped} {skipped === 1 ? "giro" : "giros"} na fila
        </p>
      ) : null}

      <span
        data-testid="overlay-status"
        className={`fixed bottom-3 right-3 size-2.5 rounded-full ${
          connected ? "bg-emerald-400" : "bg-amber-400"
        }`}
        aria-label={connected ? "Conectado" : "Reconectando"}
      />
    </div>
  );
}

function readEvent(row: unknown): RouletteOverlayEvent | null {
  const event = row as Record<string, unknown> | null;
  if (!event || typeof event.id !== "string") return null;
  if (!isDemoRoulettePrizeKey(event.prizeKey)) return null;
  return {
    id: event.id,
    prizeKey: event.prizeKey,
    productName: typeof event.productName === "string" ? event.productName : "",
    valueCents: typeof event.valueCents === "number" ? event.valueCents : 0,
    maskedDisplayName:
      typeof event.maskedDisplayName === "string" ? event.maskedDisplayName : "Jog...",
    isTopPrize: event.isTopPrize === true,
  };
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
