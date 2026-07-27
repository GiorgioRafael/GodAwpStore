import { SPIN_COST_CENTS } from "./demo";

export const WHEEL_SIZE = 360;
export const WHEEL_CENTER = WHEEL_SIZE / 2;
export const WHEEL_RADIUS = 158;
/** Extra full turns on top of the alignment, so the wheel really travels. */
export const EXTRA_TURNS = 6;

/**
 * A prize that pays at least twice the spin gets the glowing treatment: it is
 * the payout worth watching for, and the rule follows the ladder instead of
 * hard-coding which slots are the good ones.
 */
export function isBigRoulettePrize(valueCents: number) {
  return valueCents >= 2 * SPIN_COST_CENTS;
}

export function wheelSegmentPath(index: number, total: number) {
  const angle = 360 / total;
  const start = wheelPolar(index * angle - 90);
  const end = wheelPolar(index * angle - 90 + angle);
  return [
    `M ${WHEEL_CENTER} ${WHEEL_CENTER}`,
    `L ${start.x} ${start.y}`,
    `A ${WHEEL_RADIUS} ${WHEEL_RADIUS} 0 0 1 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

/**
 * Where the two lines of a slot go. Name and value are stacked vertically in
 * screen space rather than at different radii: a radial offset turns horizontal
 * on the left and right slots, and a long product name then runs straight
 * through the value.
 */
export function wheelLabelPoint(index: number, total: number) {
  const angle = 360 / total;
  return wheelPolar(index * angle - 90 + angle / 2, 104);
}

export function wheelPolar(angle: number, radius = WHEEL_RADIUS) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: WHEEL_CENTER + Math.cos(radians) * radius,
    y: WHEEL_CENTER + Math.sin(radians) * radius,
  };
}

/**
 * Spins an element with the Web Animations API instead of a CSS transition.
 * React commits the "start spinning" state and the new angle together, and a
 * transition has no previous frame to run from, so the wheel would jump
 * straight to the prize. Returns the angle it settled on.
 */
export async function spinWheelTo(
  element: SVGGElement | null,
  fromDegrees: number,
  toDegrees: number,
  durationMs: number,
) {
  if (!element?.animate) {
    // jsdom and reduced-motion fall back to the timing alone.
    await new Promise((resolve) => window.setTimeout(resolve, durationMs));
    return toDegrees;
  }

  const animation = element.animate(
    [
      { transform: `rotate(${fromDegrees}deg)` },
      { transform: `rotate(${toDegrees}deg)` },
    ],
    {
      duration: durationMs,
      // Bursts away, then a long tail that keeps the last segments tense.
      easing: "cubic-bezier(.08,.72,.06,1)",
      fill: "forwards",
    },
  );
  await animation.finished.catch(() => undefined);
  return toDegrees;
}
