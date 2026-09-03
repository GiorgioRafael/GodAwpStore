"use client";

import { runDestructiveAction } from "./destructive-action";
import { useState, useTransition } from "react";
import { Archive, LoaderCircle } from "lucide-react";

import {
  archiveRecordAction,
  type AdminActionState,
} from "@/app/actions/admin";
import { ActionFeedback, initialAdminActionState } from "@/components/admin/action-feedback";
import { AdminDialog } from "@/components/admin/admin-dialog";
import { Button } from "@/components/ui/button";

type ArchiveTarget = "game" | "substore" | "product" | "whitelist";

interface ArchiveDialogProps {
  target: ArchiveTarget;
  record: { id: string; label: string } | null;
  onClose: () => void;
  noun: string;
}

/**
 * O que arquivar faz de verdade, por tipo.
 *
 * O texto era o mesmo para tudo e não mencionava o efeito mais visível:
 * arquivar um jogo tira as vitrines dele do Discord na mesma hora. O operador
 * lia "o histórico é preservado", confirmava, e o canal esvaziava.
 */
const ARCHIVE_EFFECT: Record<string, string> = {
  game:
    "O jogo sai do catálogo e as vitrines dele são REMOVIDAS do Discord agora. Os produtos continuam salvos, e o histórico é preservado.",
  substore:
    "A categoria sai do catálogo e os produtos dela deixam de aparecer na vitrine do Discord. Nada é apagado.",
  product:
    "O produto deixa de ser vendido e sai da vitrine do Discord. O histórico de pedidos é preservado.",
  whitelist:
    "O acesso é revogado. Você pode reativá-lo depois pela própria lista.",
};

export function ArchiveDialog({ target, record, onClose, noun }: ArchiveDialogProps) {
  const [state, setState] = useState<AdminActionState>(initialAdminActionState);
  const [pending, startTransition] = useTransition();
  const isGame = target === "game";

  function archive() {
    if (!record) return;

    startTransition(async () => {
      setState(await runDestructiveAction(() => archiveRecordAction(target, record.id)));
    });
  }

  return (
    <AdminDialog
      open={Boolean(record)}
      onClose={onClose}
      title={isGame ? "Excluir jogo" : `Arquivar ${noun}`}
      description={ARCHIVE_EFFECT[target] ?? "O registro deixa de ficar disponível para novas operações, mas seu histórico é preservado."}
      footer={
        state.ok ? (
          <Button onClick={onClose}>Concluir</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={archive} disabled={pending}>
              {pending ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Archive aria-hidden="true" className="size-4" />
              )}
              {pending ? (isGame ? "Excluindo..." : "Arquivando...") : (isGame ? "Excluir jogo" : "Confirmar arquivamento")}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <p className="text-sm leading-6 text-muted-strong">
          Você está prestes a {isGame ? "excluir" : "arquivar"} <strong className="font-semibold text-foreground">{record?.label}</strong>.
        </p>
        <ActionFeedback state={state} />
      </div>
    </AdminDialog>
  );
}
