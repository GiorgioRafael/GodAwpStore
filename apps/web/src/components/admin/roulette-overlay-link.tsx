"use client";

import { useId, useMemo, useState } from "react";
import { Check, Clipboard, ExternalLink, Eye, EyeOff } from "lucide-react";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/form-field";
import {
  OVERLAY_QUEUE_DEFAULT,
  OVERLAY_QUEUE_MAXIMUM,
  withOverlayQueueLimit,
} from "@/lib/roulette/overlay-queue";

const QUEUE_CHOICES = [3, 5, OVERLAY_QUEUE_DEFAULT, 12, 20, OVERLAY_QUEUE_MAXIMUM];
const COPIED_FEEDBACK_MS = 2_000;

/**
 * Hands the OBS address to the operator. The token travels in the query string,
 * so the field starts masked: the panel is shared over the shoulder more often
 * than the link is copied.
 */
export function RouletteOverlayLink({ overlayUrl }: { overlayUrl: string }) {
  const fieldId = useId();
  const [queueLimit, setQueueLimit] = useState(OVERLAY_QUEUE_DEFAULT);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const url = useMemo(
    () => withOverlayQueueLimit(overlayUrl, queueLimit),
    [overlayUrl, queueLimit],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    } catch {
      // Clipboard access can be denied; revealing lets the operator select it.
      setRevealed(true);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Overlay para OBS e TikTok Studio
          </h2>
          <p className="mt-1 text-sm text-muted">
            Adicione como <strong>Fonte de navegador</strong>, 1920 × 1080, e marque a opção de
            desligar a fonte quando ela não estiver visível.
          </p>
        </div>
        <Badge tone="warning">Link secreto</Badge>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <Field
          label="Endereço do overlay"
          htmlFor={`${fieldId}-url`}
          hint="Quem tiver o link vê a transmissão"
        >
          <div className="flex flex-wrap gap-2">
            <Input
              id={`${fieldId}-url`}
              className="min-w-0 flex-1 font-mono text-xs"
              value={revealed ? url : maskToken(url)}
              readOnly
              spellCheck={false}
              // Selecting the masked text would hand the operator a link made of
              // dots, so the shortcut only exists once the token is visible.
              onFocus={(event) => {
                if (revealed) event.currentTarget.select();
              }}
            />
            <Button
              variant="secondary"
              onClick={() => setRevealed((current) => !current)}
              aria-label={revealed ? "Ocultar o token" : "Mostrar o token"}
            >
              {revealed ? (
                <EyeOff aria-hidden="true" className="size-4" />
              ) : (
                <Eye aria-hidden="true" className="size-4" />
              )}
            </Button>
            <Button onClick={copy}>
              {copied ? (
                <Check aria-hidden="true" className="size-4" />
              ) : (
                <Clipboard aria-hidden="true" className="size-4" />
              )}
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_1fr] sm:items-end">
          <Field
            label="Fila de animações"
            htmlFor={`${fieldId}-fila`}
            hint={`Padrão ${OVERLAY_QUEUE_DEFAULT}`}
          >
            <Select
              id={`${fieldId}-fila`}
              value={queueLimit}
              onChange={(event) => setQueueLimit(Number(event.target.value))}
            >
              {QUEUE_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  {choice} giros
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-2">
            <LinkButton
              href={url}
              target="_blank"
              rel="noreferrer"
              variant="secondary"
              prefetch={false}
            >
              <ExternalLink aria-hidden="true" className="size-4" />
              Abrir overlay
            </LinkButton>
          </div>
        </div>

        <p className="text-xs leading-5 text-muted">
          A fila segura quantos giros o overlay ainda vai animar quando muita gente joga ao mesmo
          tempo. O site do jogador nunca espera por ela, e quem tira o prêmio máximo fura o limite.
          Os nomes aparecem sempre mascarados.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Keeps the address readable while hiding the part that grants access. The run
 * of dots is fixed so the mask never gives away how long the token is, and a
 * short token gets no visible prefix at all.
 */
function maskToken(url: string) {
  return url.replace(/([?&]token=)([^&]*)/, (_match, prefix: string, token: string) => {
    const hint = token.length >= 12 ? token.slice(0, 3) : "";
    return `${prefix}${hint}${"•".repeat(10)}`;
  });
}
