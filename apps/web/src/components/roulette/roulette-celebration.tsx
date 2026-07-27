"use client";

const COLORS = ["#fbbf24", "#f472b6", "#e879f9", "#fde68a", "#a78bfa", "#34d399"];

const PIECES = Array.from({ length: 34 }, (_, index) => ({
  left: 4 + ((index * 41) % 92),
  color: COLORS[index % COLORS.length],
  duration: 1_500 + ((index * 137) % 1_500),
  delay: (index * 53) % 700,
  drift: ((index % 7) - 3) * 26,
  size: index % 3 === 0 ? 12 : 9,
}));

/**
 * Confetti burst for a prize worth watching. It is decorative only, so it stays
 * out of the accessibility tree and never intercepts clicks.
 */
export function RouletteConfetti({ gold = false }: { gold?: boolean }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {PIECES.map((piece, index) => (
        <span
          key={index}
          className="absolute top-[34%] rounded-[2px]"
          style={{
            left: `${piece.left}%`,
            width: piece.size,
            height: piece.size,
            backgroundColor: gold && index % 2 === 0 ? "#fbbf24" : piece.color,
            ["--confetti-drift" as string]: `${piece.drift}px`,
            animation: `confetti ${piece.duration}ms ${piece.delay}ms cubic-bezier(.2,.7,.3,1) forwards`,
          }}
        />
      ))}
    </div>
  );
}
