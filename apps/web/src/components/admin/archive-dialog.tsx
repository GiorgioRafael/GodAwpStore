"use client";

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

export function ArchiveDialog({ target, record, onClose, noun }: ArchiveDialogProps) {
  const [state, setState] = useState<AdminActionState>(initialAdminActionState);
  const [pending, startTransition] = useTransition();

  function archive() {
    if (!record) return;

    startTransition(async () => {
      const result = await archiveRecordAction(target, record.id);
      setState(result);
    });
  }

  return (
    <AdminDialog
      open={Boolean(record)}
      onClose={onClose}
      title={`Arquivar ${noun}`}
      description="O registro deixa de ficar disponível para novas operações, mas seu histórico é preservado."
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
              {pending ? "Arquivando..." : "Confirmar arquivamento"}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <p className="text-sm leading-6 text-muted-strong">
          Você está prestes a arquivar <strong className="font-semibold text-foreground">{record?.label}</strong>.
        </p>
        <ActionFeedback state={state} />
      </div>
    </AdminDialog>
  );
}
