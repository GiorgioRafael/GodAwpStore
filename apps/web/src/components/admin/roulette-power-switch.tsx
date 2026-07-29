"use client";

import { useActionState } from "react";
import { Pause, Play } from "lucide-react";
import { toggleRouletteAction } from "@/app/actions/roulette-wheel";
import { ActionFeedback, initialAdminActionState } from "./action-feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Stops new spins without touching anything a player already owns. Pausing is
 * the move when a prize runs out of stock or the wheel is being retuned, and it
 * has to be one click away from the numbers that reveal the problem.
 */
export function RoulettePowerSwitch({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState(
    toggleRouletteAction,
    initialAdminActionState,
  );

  return (
    <Card>
      <CardContent className="space-y-3">
        <ActionFeedback state={state} />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-semibold tracking-tight">Roleta</h2>
              <Badge tone={enabled ? "success" : "warning"}>
                {enabled ? "No ar" : "Pausada"}
              </Badge>
            </div>
            <p className="mt-1 max-w-xl text-sm text-muted">
              {enabled
                ? "Os jogadores podem girar. Pausar só bloqueia novos giros — saldo, inventário e resgates em andamento continuam como estão."
                : "Ninguém consegue girar. Quem tem moedas continua com elas, e os resgates em aberto seguem normalmente."}
            </p>
          </div>
          <form action={action}>
            {enabled ? null : <input type="hidden" name="enabled" value="on" />}
            <Button
              type="submit"
              variant={enabled ? "secondary" : "primary"}
              disabled={pending}
            >
              {enabled ? (
                <Pause aria-hidden="true" className="size-4" />
              ) : (
                <Play aria-hidden="true" className="size-4" />
              )}
              {pending ? "Aplicando..." : enabled ? "Pausar a roleta" : "Liberar a roleta"}
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
