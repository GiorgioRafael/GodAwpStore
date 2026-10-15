import Link from "next/link";
import type { ReactNode } from "react";
import { Diamond, X, type LucideIcon } from "lucide-react";
import { BrandMark } from "@/components/layout/brand-mark";
import { cssVars } from "./shop-visuals";
import ui from "./shop.module.css";

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

/** Overline above headings: a small icon (a diamond by default) and uppercase display text. */
export function Kicker({ icon: Icon, children, className }: { icon?: LucideIcon; children: ReactNode; className?: string }) {
  return <p className={cx(ui.kicker, className)}>
    {Icon ? <Icon size={13} aria-hidden="true" /> : <Diamond size={10} fill="currentColor" aria-hidden="true" />}{children}</p>;
}

/** Decorative diamond emblem: a rotated square holding an icon, tinted by `hue` (defaults to the accent). */
export function Emblem({ icon: Icon, size = "m", hue, className }: { icon: LucideIcon; size?: "s" | "m" | "l"; hue?: string; className?: string }) {
  return <span className={cx(ui.emblem, className)} data-size={size} style={hue ? cssVars({ "--hue": hue }) : undefined} aria-hidden="true">
    <Icon size={{ s: 16, m: 20, l: 24 }[size]} strokeWidth={1.75} aria-hidden="true" /></span>;
}

/** Empty/error state. The h3 and the action stay direct siblings (tests read heading.parentElement). */
export function EmptyState({ icon, title, text, action, tone = "accent", inset = false }: {
  icon: LucideIcon; title: string; text: string; action?: ReactNode; tone?: "accent" | "danger"; inset?: boolean;
}) {
  return <div className={ui.emptyState} data-inset={inset ? "" : undefined}>
    <Emblem icon={icon} size="l" hue={tone === "danger" ? "#ff8aa3" : undefined} /><h3>{title}</h3><p>{text}</p>{action}</div>;
}

export function SearchStatus({ message, search, onClear }: { message: string; search: string; onClear: () => void }) {
  return <p className={ui.searchResult} role="status">{message} para “{search}”
    <button type="button" onClick={onClear} aria-label="Limpar busca"><X size={15} aria-hidden="true" /></button></p>;
}

export function ShopBrandLink({ label, onNavigate, priority = false, className }: {
  label?: string; onNavigate?: () => void; priority?: boolean; className?: string;
}) {
  return <Link href="/" onNavigate={onNavigate} aria-label={label} className={cx(ui.brand, className)}>
    <span className={ui.brandMark}><BrandMark priority={priority} /></span><span className={ui.wordmark}>GW<span>Store</span></span></Link>;
}
