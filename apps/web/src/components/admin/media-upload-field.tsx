"use client";

import { useId, useState } from "react";
import { ExternalLink, ImagePlus, LoaderCircle, Trash2 } from "lucide-react";

import { MediaThumbnail } from "@/components/admin/media-thumbnail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-field";

type MediaFolder = "games" | "substores" | "products";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxFileSize = 5 * 1024 * 1024;

interface MediaUploadFieldProps {
  name: string;
  label: string;
  folder: MediaFolder;
  initialValue?: string | null;
  error?: string;
  hint?: string;
}

function responseMessage(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return fallback;
}

export function MediaUploadField({
  name,
  label,
  folder,
  initialValue = null,
  error,
  hint = "JPG, PNG ou WebP de até 5 MB.",
}: MediaUploadFieldProps) {
  const id = useId();
  const [value, setValue] = useState(initialValue ?? "");
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploadError, setUploadError] = useState("");

  async function upload(file: File) {
    setUploadMessage("");
    setUploadError("");

    if (!allowedTypes.has(file.type)) {
      setUploadError("Use uma imagem JPG, PNG ou WebP.");
      return;
    }
    if (file.size <= 0 || file.size > maxFileSize) {
      setUploadError("A imagem deve ter no máximo 5 MB.");
      return;
    }

    setUploading(true);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("folder", folder);
      const response = await fetch("/api/admin/media", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body,
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setUploadError(responseMessage(payload, "Não foi possível enviar a imagem."));
        return;
      }

      if (
        !payload ||
        typeof payload !== "object" ||
        !("publicUrl" in payload) ||
        typeof payload.publicUrl !== "string"
      ) {
        setUploadError("O upload terminou sem retornar a URL da imagem.");
        return;
      }

      setValue(payload.publicUrl);
      setUploadMessage("Upload concluído. Salve o formulário para vincular a imagem.");
    } catch {
      setUploadError("Falha de conexão durante o upload. Tente novamente.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-muted-strong">
          {label}
        </label>
        <span className="text-xs text-muted">{hint}</span>
      </div>
      <input type="hidden" name={name} value={value} />
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-muted p-3 sm:flex-row sm:items-center">
        <MediaThumbnail src={value || null} alt={value ? `Prévia de ${label.toLowerCase()}` : ""} />
        <div className="min-w-0 flex-1">
          <Input
            id={id}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={uploading}
            aria-describedby={`${id}-status`}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = "";
            }}
            className="file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-gold-bright"
          />
          <div id={`${id}-status`} className="mt-2 min-h-5 text-xs">
            {uploading ? (
              <span role="status" className="inline-flex items-center gap-1.5 text-muted-strong">
                <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                Enviando imagem...
              </span>
            ) : uploadError || error ? (
              <span role="alert" className="text-danger">
                {uploadError || error}
              </span>
            ) : uploadMessage ? (
              <span role="status" className="text-success">
                {uploadMessage}
              </span>
            ) : (
              <span className="text-muted">O upload começa assim que o arquivo é selecionado.</span>
            )}
          </div>
        </div>
        <div className="flex gap-1 sm:flex-col">
          {value ? (
            <a
              href={value}
              target="_blank"
              rel="noreferrer"
              className="inline-flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/[0.05] hover:text-foreground"
              aria-label={`Abrir ${label.toLowerCase()}`}
            >
              <ExternalLink aria-hidden="true" className="size-4" />
            </a>
          ) : (
            <span className="grid size-9 place-items-center text-muted" aria-hidden="true">
              <ImagePlus className="size-4" />
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9"
            disabled={!value || uploading}
            onClick={() => {
              setValue("");
              setUploadMessage("A imagem será desvinculada quando o formulário for salvo.");
              setUploadError("");
            }}
            aria-label={`Remover ${label.toLowerCase()} do registro`}
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
