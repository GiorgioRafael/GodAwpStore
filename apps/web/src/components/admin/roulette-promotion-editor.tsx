"use client";

import { useActionState, useId } from "react";
import { ExternalLink, Megaphone } from "lucide-react";

import { saveRoulettePromotionAction } from "@/app/actions/roulette-promotion";
import {
  ActionFeedback,
  fieldError,
  initialAdminActionState,
} from "@/components/admin/action-feedback";
import { Button, LinkButton } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/form-field";
import type { RoulettePromotionSettings } from "@/lib/roulette/promotion-admin";

export function RoulettePromotionEditor({
  settings,
  rouletteUrl,
}: {
  settings: RoulettePromotionSettings;
  rouletteUrl: string;
}) {
  const formId = useId();
  const [state, action, pending] = useActionState(
    saveRoulettePromotionAction,
    initialAdminActionState,
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <Megaphone aria-hidden="true" className="size-4 text-gold" />
              <h2 className="text-base font-semibold tracking-tight">
                Divulgação no Discord
              </h2>
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
              Edite o anúncio do canal{" "}
              <strong className="text-muted-strong">🎰┊roleta</strong>. Ao
              salvar, o bot atualiza a mensagem já publicada; se ela tiver sido
              apagada, cria outra automaticamente.
            </p>
          </div>
          <LinkButton
            href={rouletteUrl}
            target="_blank"
            rel="noreferrer"
            variant="secondary"
            size="sm"
          >
            Ver roleta
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </LinkButton>
        </div>
      </CardHeader>
      <form action={action}>
        <CardContent className="space-y-4 pt-5">
          <ActionFeedback state={state} />
          <Field
            label="Título"
            htmlFor={`${formId}-title`}
            hint="Até 120 caracteres"
            error={fieldError(state, "title")}
          >
            <Input
              id={`${formId}-title`}
              name="title"
              defaultValue={settings.title}
              maxLength={120}
              required
            />
          </Field>
          <Field
            label="Mensagem"
            htmlFor={`${formId}-description`}
            hint="Até 1.000 caracteres"
            error={fieldError(state, "description")}
          >
            <Textarea
              id={`${formId}-description`}
              name="description"
              defaultValue={settings.description}
              maxLength={1_000}
              required
            />
          </Field>
          <Field
            label="Texto do botão"
            htmlFor={`${formId}-button`}
            hint="O link da roleta permanece protegido"
            error={fieldError(state, "buttonLabel")}
          >
            <Input
              id={`${formId}-button`}
              name="buttonLabel"
              defaultValue={settings.buttonLabel}
              maxLength={80}
              required
            />
          </Field>
          <div className="rounded-xl border border-border bg-surface-muted px-4 py-3 text-xs leading-5 text-muted">
            O botão sempre abre{" "}
            <span className="font-medium text-muted-strong">{rouletteUrl}</span>
            . Assim uma edição de texto não consegue mandar jogadores para um
            endereço errado.
          </div>
        </CardContent>
        <CardFooter className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-xs text-muted">
            {settings.messageId
              ? "A publicação está vinculada ao painel."
              : "Ao salvar, o painel localizará ou publicará a mensagem."}
          </p>
          <Button type="submit" disabled={pending}>
            <Megaphone aria-hidden="true" className="size-4" />
            {pending ? "Atualizando..." : "Salvar e atualizar no Discord"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
