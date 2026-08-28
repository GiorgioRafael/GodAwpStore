"use client";

import { useState, useTransition } from "react";
import { Archive, LoaderCircle, Trash2, TriangleAlert } from "lucide-react";

import {
  deleteProductAction,
  deleteRecordPermanentlyAction,
  type AdminActionState,
} from "@/app/actions/admin";
import { ActionFeedback, initialAdminActionState } from "@/components/admin/action-feedback";
import { AdminDialog } from "@/components/admin/admin-dialog";
import { Button } from "@/components/ui/button";

type PermanentDeleteTarget = "game" | "substore" | "catalogStore" | "product" | "whitelist";

interface DeleteRecordDialogProps {
  target: PermanentDeleteTarget;
  record: { id: string; label: string; blockedReason?: string | null } | null;
  onClose: () => void;
  noun: string;
  description?: string;
  onArchive?: (record: { id: string; label: string }) => void;
}

export function DeleteRecordDialog({
  target,
  record,
  onClose,
  noun,
  description = "A exclusão definitiva só é permitida para registros sem dependências nem histórico.",
  onArchive,
}: DeleteRecordDialogProps) {
  const [state, setState] = useState<AdminActionState>(initialAdminActionState);
  const [pending, startTransition] = useTransition();
  const blockedReason = record?.blockedReason ?? null;

  function close() {
    setState(initialAdminActionState);
    onClose();
  }

  function remove() {
    if (!record || blockedReason) return;
    startTransition(async () => {
      setState(
        target === "product"
          ? await deleteProductAction(record.id)
          : await deleteRecordPermanentlyAction(target, record.id),
      );
    });
  }

  return (
    <AdminDialog
      open={Boolean(record)}
      onClose={close}
      title={`Excluir ${noun} definitivamente`}
      description={description}
      footer={
        state.ok ? (
          <Button onClick={close}>Concluir</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancelar
            </Button>
            {record && onArchive ? (
              <Button
                variant="secondary"
                onClick={() => onArchive(record)}
                disabled={pending}
              >
                <Archive aria-hidden="true" className="size-4" />
                Arquivar {noun}
              </Button>
            ) : null}
            <Button
              variant="danger"
              onClick={remove}
              disabled={pending || Boolean(blockedReason)}
            >
              {pending ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Trash2 aria-hidden="true" className="size-4" />
              )}
              {pending ? "Excluindo..." : "Excluir definitivamente"}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <p className="text-sm leading-6 text-muted-strong">
          Você está prestes a excluir permanentemente{" "}
          <strong className="font-semibold text-foreground">{record?.label}</strong>.
          Esta ação não pode ser desfeita.
        </p>
        {blockedReason ? (
          <div className="flex gap-3 rounded-xl border border-warning/25 bg-warning/[0.06] p-3 text-warning">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <p className="text-sm leading-5">{blockedReason}</p>
          </div>
        ) : null}
        <ActionFeedback state={state} />
      </div>
    </AdminDialog>
  );
}
