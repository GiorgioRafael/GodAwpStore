import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";

interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  trend?: "up" | "down";
}

export function MetricCard({ label, value, detail, icon: Icon, trend }: MetricCardProps) {
  const TrendIcon = trend === "up" ? ArrowUpRight : ArrowDownRight;

  return (
    <Card className="group relative overflow-hidden p-5 transition-colors hover:border-border-strong">
      <div aria-hidden="true" className="absolute -right-8 -top-10 size-28 rounded-full bg-gold/[0.035] blur-2xl transition-colors group-hover:bg-gold/[0.07]" />
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted-strong">{label}</p>
          <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-foreground">{value}</p>
        </div>
        <span className="grid size-10 place-items-center rounded-xl border border-gold/15 bg-gold/[0.06] text-gold">
          <Icon aria-hidden="true" className="size-[18px]" strokeWidth={1.8} />
        </span>
      </div>
      <p className="relative mt-4 flex items-center gap-1.5 text-xs text-muted">
        {trend ? (
          <TrendIcon
            aria-hidden="true"
            className={cn("size-3.5", trend === "up" ? "text-success" : "text-danger")}
          />
        ) : null}
        {detail}
      </p>
    </Card>
  );
}
