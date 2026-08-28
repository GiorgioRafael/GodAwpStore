import type { AdminActionState } from "@/app/actions/admin";

/**
 * Runs a destructive server action so a thrown error is still something the
 * operator can read.
 *
 * The delete and archive dialogs awaited the action bare inside a transition.
 * A network drop, a serverless timeout or an unhandled throw left the promise
 * rejected, the pending flag back to false and no state written: the spinner
 * vanished, the dialog stayed open and nothing at all appeared. To the person
 * clicking, the button simply did not work — which is exactly how it was
 * reported.
 */
export async function runDestructiveAction(
  action: () => Promise<AdminActionState>,
): Promise<AdminActionState> {
  try {
    return await action();
  } catch (error) {
    console.error(
      `[admin:acao-destrutiva] ${error instanceof Error ? error.message : "erro desconhecido"}`,
    );
    return {
      ok: false,
      message:
        "A ação não chegou ao servidor. Verifique a conexão e tente de novo — nada foi alterado.",
    };
  }
}
