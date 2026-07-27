"use client";

import { useEffect, useRef, useState } from "react";

import {
  demoRouletteRotation,
  formatCoins,
  isDemoRoulettePrizeKey,
  rouletteWheelPrize,
  type DemoRoulettePrizeKey,
  type RouletteWheelPrize,
} from "@/lib/roulette/demo";
import { readRouletteOverlayEvents } from "@/app/roleta/overlay/actions";

const WHEEL_SIZE = 360;
const WHEEL_CENTER = WHEEL_SIZE / 2;
const WHEEL_RADIUS = 164;
const DEFAULT_SPIN_MS = 2_600;
const DEFAULT_RESULT_MS = 2_200;
const POLL_MS = 1_500;

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
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const [connected, setConnected] = useState(false);
  const queue = useRef<RouletteOverlayEvent[]>([]);
  const rotationRef = useRef(0);
  const busy = useRef(false);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    let since: string | null = null;

    async function play() {
      if (busy.current || !active) return;
      const next = queue.current.shift();
      if (!next) return;
      busy.current = true;

      setSpinning(true);
      const nextRotation = demoRouletteRotation(rotationRef.current, next.prizeKey);
      rotationRef.current = nextRotation;
      setRotation(nextRotation);
      await wait(spinMs);
      if (!active) return;

      setSpinning(false);
      setCurrent(next);
      await wait(resultMs);
      if (!active) return;

      setCurrent(null);
      busy.current = false;
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
        const events = await readRouletteOverlayEvents(token, since);
        if (!active) return;
        setConnected(true);
        for (const raw of events) {
          if (raw.createdAt > (since ?? "")) since = raw.createdAt;
          const event = readEvent(raw);
          if (event) enqueue(event);
        }
      } catch {
        if (active) setConnected(false);
      }
    }

    void poll();
    const timer = window.setInterval(() => void poll(), pollMs);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [queueLimit, spinMs, resultMs, pollMs, token]);

  const prize = current ? rouletteWheelPrize(prizes, current.prizeKey) : null;

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center gap-6 bg-transparent p-8">
      <div
        className={`relative aspect-square w-[420px] transition-opacity duration-500 ${
          spinning || current ? "opacity-100" : "opacity-35"
        }`}
      >
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-[-2px] z-20 h-0 w-0 -translate-x-1/2 drop-shadow-[0_0_14px_rgba(244,114,182,.95)]"
          style={{
            borderLeft: "20px solid transparent",
            borderRight: "20px solid transparent",
            borderTop: "36px solid #e879f9",
          }}
        />
        <div className="absolute inset-[4%] rounded-full border-2 border-fuchsia-200/60 bg-[#0b0710]/90 p-2 shadow-[0_0_60px_rgba(217,70,239,.45)]">
          <svg
            viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`}
            role="img"
            aria-label="Roleta da GWStore"
            className="size-full overflow-visible rounded-full"
            style={{
              transform: `rotate(${rotation}deg)`,
              transformOrigin: "50% 50%",
              transitionDuration: spinning ? `${spinMs}ms` : "0ms",
              transitionProperty: "transform",
              transitionTimingFunction: "cubic-bezier(.12,.68,.08,1)",
            }}
          >
            <circle
              cx={WHEEL_CENTER}
              cy={WHEEL_CENTER}
              r={WHEEL_RADIUS + 5}
              fill="#08040c"
              stroke="rgba(244,114,182,.8)"
              strokeWidth="3"
            />
            {prizes.map((slot, index) => {
              const label = labelPoint(index, prizes.length);
              return (
                <g key={slot.key}>
                  <path
                    d={segmentPath(index, prizes.length)}
                    fill={slot.surface}
                    stroke="rgba(232,121,249,.4)"
                    strokeWidth="1.6"
                  />
                  <text
                    x={label.x}
                    y={label.y}
                    textAnchor="middle"
                    fill="#fff8ff"
                    fontSize="14"
                    fontWeight="700"
                  >
                    {slot.wheelLabel}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {prize && current ? (
        <div
          data-testid="overlay-result"
          className={`rounded-2xl border px-8 py-5 text-center shadow-[0_20px_60px_rgba(0,0,0,.55)] backdrop-blur ${
            current.isTopPrize
              ? "border-amber-300/70 bg-[#241a05]/95"
              : "border-fuchsia-300/45 bg-[#140b1a]/95"
          }`}
        >
          {current.isTopPrize ? (
            <p className="text-sm font-black uppercase tracking-[0.2em] text-amber-300">
              Prêmio máximo
            </p>
          ) : null}
          <p className="text-2xl font-bold text-white">
            <span className="text-fuchsia-300">{current.maskedDisplayName}</span> ganhou
          </p>
          <p className="mt-1 text-3xl font-black tracking-[-0.03em] text-white">
            {prize.displayName}
          </p>
          <p className="mt-1 text-lg font-bold text-amber-200">
            {formatCoins(current.valueCents)} moedas
          </p>
        </div>
      ) : null}

      {skipped > 0 ? (
        <p
          data-testid="overlay-skipped"
          className="rounded-full border border-white/15 bg-black/45 px-4 py-1.5 text-sm font-semibold text-white/80"
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
  return polar(index * angle - 90 + angle / 2, 105);
}

function polar(angle: number, radius = WHEEL_RADIUS) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: WHEEL_CENTER + Math.cos(radians) * radius,
    y: WHEEL_CENTER + Math.sin(radians) * radius,
  };
}
