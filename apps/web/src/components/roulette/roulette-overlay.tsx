"use client";

import { useEffect, useRef, useState } from "react";

import { readRouletteOverlayEvents } from "@/app/roleta/overlay/actions";
import { BrandMark } from "@/components/layout/brand-mark";
import {
  demoRouletteRotation,
  formatCoins,
  isDemoRoulettePrizeKey,
  rouletteWheelPrize,
  type DemoRoulettePrizeKey,
  type RouletteWheelPrize,
} from "@/lib/roulette/demo";

const WHEEL_SIZE = 360;
const WHEEL_CENTER = WHEEL_SIZE / 2;
const WHEEL_RADIUS = 158;
const DEFAULT_SPIN_MS = 4_600;
const DEFAULT_RESULT_MS = 3_400;
const POLL_MS = 1_500;
/** Extra full turns on top of the alignment, so the wheel really travels. */
const EXTRA_TURNS = 6;
const IDLE_TURN_MS = 44_000;

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
 *
 * The wheel is driven by the Web Animations API instead of a CSS transition:
 * the state that starts a spin and the state that moves it land in the same
 * React commit, and a transition has no previous frame to run from, so the
 * wheel used to jump straight to the prize.
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
  const [spinning, setSpinning] = useState(false);
  const [landed, setLanded] = useState(false);
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

    async function turnWheel(prizeKey: DemoRoulettePrizeKey) {
      const wheel = wheelRef.current;
      const from = rotationRef.current;
      const to = demoRouletteRotation(from, prizeKey) + EXTRA_TURNS * 360;
      rotationRef.current = to;

      // jsdom has no Web Animations API; the tests only need the timing.
      if (!wheel?.animate) {
        await wait(spinMs);
        return;
      }

      stopIdle();
      const animation = wheel.animate(
        [{ transform: `rotate(${from}deg)` }, { transform: `rotate(${to}deg)` }],
        {
          duration: spinMs,
          // Bursts away, then a long tail that keeps the last segments tense.
          easing: "cubic-bezier(.08,.72,.06,1)",
          fill: "forwards",
        },
      );
      await animation.finished.catch(() => undefined);
    }

    async function play() {
      if (busy.current || !active) return;
      const next = queue.current.shift();
      if (!next) return;
      busy.current = true;

      setLanded(false);
      setSpinning(true);
      await turnWheel(next.prizeKey);
      if (!active) return;

      setSpinning(false);
      setCurrent(next);
      setLanded(true);
      await wait(resultMs);
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
  }, [queueLimit, spinMs, resultMs, pollMs, token]);

  const prize = current ? rouletteWheelPrize(prizes, current.prizeKey) : null;
  const jackpot = Boolean(current?.isTopPrize);

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center gap-7 bg-transparent p-8">
      {jackpot && landed ? <Confetti /> : null}

      <div
        className={`relative aspect-square w-[460px] transition-all duration-700 ${
          spinning || current ? "scale-100 opacity-100" : "scale-95 opacity-70"
        }`}
      >
        <div
          aria-hidden="true"
          className={`absolute inset-[-8%] rounded-full blur-3xl transition-colors duration-500 ${
            jackpot && landed ? "bg-amber-400/35" : "bg-fuchsia-500/20"
          }`}
        />

        <span
          aria-hidden="true"
          className="absolute left-1/2 top-[-6px] z-30 h-0 w-0 -translate-x-1/2 drop-shadow-[0_0_18px_rgba(244,114,182,1)]"
          style={{
            borderLeft: "22px solid transparent",
            borderRight: "22px solid transparent",
            borderTop: `42px solid ${jackpot && landed ? "#fbbf24" : "#e879f9"}`,
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
              <linearGradient
                key={slot.key}
                id={`slot-${index}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={slot.accent} stopOpacity="0.42" />
                <stop offset="100%" stopColor={slot.surface} stopOpacity="1" />
              </linearGradient>
            ))}
            <radialGradient id="hub" cx="50%" cy="35%">
              <stop offset="0%" stopColor="#2a0f36" />
              <stop offset="100%" stopColor="#08040c" />
            </radialGradient>
          </defs>

          {/* Anel externo com luzes */}
          <circle
            cx={WHEEL_CENTER}
            cy={WHEEL_CENTER}
            r={WHEEL_RADIUS + 16}
            fill="none"
            stroke={jackpot && landed ? "rgba(251,191,36,.9)" : "rgba(244,114,182,.55)"}
            strokeWidth="4"
          />
          <circle
            cx={WHEEL_CENTER}
            cy={WHEEL_CENTER}
            r={WHEEL_RADIUS + 9}
            fill="none"
            stroke={jackpot && landed ? "rgba(251,191,36,.65)" : "rgba(232,121,249,.45)"}
            strokeWidth="3"
            strokeDasharray="2 12"
            strokeLinecap="round"
          />

          <g ref={wheelRef} style={{ transformOrigin: "50% 50%" }}>
            {prizes.map((slot, index) => {
              const label = labelPoint(index, prizes.length);
              const value = valuePoint(index, prizes.length);
              return (
                <g key={slot.key}>
                  <path
                    d={segmentPath(index, prizes.length)}
                    fill={`url(#slot-${index})`}
                    stroke="rgba(255,255,255,.16)"
                    strokeWidth="1.5"
                  />
                  <text
                    x={label.x}
                    y={label.y}
                    textAnchor="middle"
                    fill="#fff8ff"
                    fontSize="15"
                    fontWeight="800"
                    style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,.55)", strokeWidth: 3 }}
                  >
                    {slot.wheelLabel}
                  </text>
                  <text
                    x={value.x}
                    y={value.y}
                    textAnchor="middle"
                    fill={slot.accent}
                    fontSize="15"
                    fontWeight="900"
                    style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,.6)", strokeWidth: 3 }}
                  >
                    {formatCoins(slot.valueCents)}
                  </text>
                </g>
              );
            })}
          </g>

          {/* Miolo fixo com a marca */}
          <circle cx={WHEEL_CENTER} cy={WHEEL_CENTER} r="52" fill="url(#hub)" />
          <circle
            cx={WHEEL_CENTER}
            cy={WHEEL_CENTER}
            r="52"
            fill="none"
            stroke={jackpot && landed ? "rgba(251,191,36,.95)" : "rgba(244,114,182,.75)"}
            strokeWidth="3"
          />
        </svg>

        <span className="pointer-events-none absolute left-1/2 top-1/2 grid size-[26%] -translate-x-1/2 -translate-y-1/2 place-items-center overflow-hidden rounded-full">
          <BrandMark className="rounded-full" />
        </span>
      </div>

      <div aria-live="polite" className="flex min-h-[132px] items-start justify-center">
        {prize && current ? (
          <div
            data-testid="overlay-result"
            className={`animate-[popIn_.45s_cubic-bezier(.2,1.4,.4,1)] rounded-3xl border-2 px-10 py-6 text-center shadow-[0_24px_70px_rgba(0,0,0,.65)] backdrop-blur ${
              jackpot
                ? "border-amber-300 bg-gradient-to-b from-[#2c1f04]/95 to-[#160f02]/95"
                : "border-fuchsia-300/60 bg-gradient-to-b from-[#1d0f26]/95 to-[#0f0714]/95"
            }`}
          >
            {jackpot ? (
              <p className="mb-1 text-sm font-black uppercase tracking-[0.28em] text-amber-300">
                ★ Prêmio máximo ★
              </p>
            ) : null}
            <p className="text-2xl font-bold text-white">
              <span className={jackpot ? "text-amber-300" : "text-fuchsia-300"}>
                {current.maskedDisplayName}
              </span>{" "}
              ganhou
            </p>
            <p className="mt-1 text-4xl font-black tracking-[-0.035em] text-white">
              {prize.displayName}
            </p>
            <p
              className={`mt-2 inline-block rounded-full px-4 py-1 text-lg font-black ${
                jackpot ? "bg-amber-400/25 text-amber-200" : "bg-fuchsia-400/20 text-fuchsia-200"
              }`}
            >
              {formatCoins(current.valueCents)} moedas
            </p>
          </div>
        ) : null}
      </div>

      {skipped > 0 ? (
        <p
          data-testid="overlay-skipped"
          className="rounded-full border border-white/15 bg-black/50 px-4 py-1.5 text-sm font-semibold text-white/80"
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

/** Burst that only the biggest prize earns. */
function Confetti() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {CONFETTI.map((piece, index) => (
        <span
          key={index}
          className="absolute top-[38%] size-2.5 rounded-[2px]"
          style={{
            left: `${piece.left}%`,
            backgroundColor: piece.color,
            animation: `confetti ${piece.duration}ms ${piece.delay}ms cubic-bezier(.2,.7,.3,1) forwards`,
          }}
        />
      ))}
    </div>
  );
}

const CONFETTI_COLORS = ["#fbbf24", "#f472b6", "#e879f9", "#fde68a", "#a78bfa"];
const CONFETTI = Array.from({ length: 28 }, (_, index) => ({
  left: 6 + ((index * 37) % 88),
  color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
  duration: 1_600 + ((index * 131) % 1_400),
  delay: (index * 47) % 600,
}));

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

function segmentPath(index: number, total: number) {
  const angle = 360 / total;
  const start = polar(index * angle - 90);
  const end = polar(index * angle - 90 + angle);
  return [
    `M ${WHEEL_CENTER} ${WHEEL_CENTER}`,
    `L ${start.x} ${start.y}`,
    `A ${WHEEL_RADIUS} ${WHEEL_RADIUS} 0 0 1 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

function labelPoint(index: number, total: number) {
  const angle = 360 / total;
  return polar(index * angle - 90 + angle / 2, 112);
}

function valuePoint(index: number, total: number) {
  const angle = 360 / total;
  return polar(index * angle - 90 + angle / 2, 82);
}

function polar(angle: number, radius = WHEEL_RADIUS) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: WHEEL_CENTER + Math.cos(radians) * radius,
    y: WHEEL_CENTER + Math.sin(radians) * radius,
  };
}
