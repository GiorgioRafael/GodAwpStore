import { uuidSchema } from "@godawp/domain";

import { authorizeAdminRequest } from "@/lib/api-auth";
import { revealInventorySecret } from "@/lib/inventory-security";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RevealContext = {
  params: Promise<{ unitId: string }>;
};

function rowFromRpc(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    const row = data[0];
    return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
  }
  return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
}

export async function POST(_request: Request, context: RevealContext) {
  const authorization = await authorizeAdminRequest();
  if (!authorization.ok) return authorization.response;

  const { unitId } = await context.params;
  const parsedId = uuidSchema.safeParse(unitId);
  if (!parsedId.success) {
    return Response.json({ error: "Unidade inválida." }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return Response.json({ error: "Supabase não configurado." }, { status: 503 });

  const { data, error } = await supabase.rpc("admin_get_inventory_secret", {
    p_unit_id: parsedId.data,
  });
  if (error) {
    return Response.json({ error: "Não foi possível auditar a revelação." }, { status: 500 });
  }

  const row = rowFromRpc(data);
  const productId = row?.product_id;
  const ciphertext = row?.encrypted_payload;
  const iv = row?.iv;
  const authTag = row?.auth_tag;
  if (
    typeof productId !== "string" ||
    typeof ciphertext !== "string" ||
    typeof iv !== "string" ||
    typeof authTag !== "string"
  ) {
    return Response.json({ error: "Unidade não encontrada." }, { status: 404 });
  }

  try {
    const secret = revealInventorySecret(
      { version: 1, algorithm: "aes-256-gcm", ciphertext, iv, authTag },
      productId,
    );

    return Response.json(
      { unitId: parsedId.data, secret, revealedAt: new Date().toISOString() },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
          Pragma: "no-cache",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch {
    return Response.json({ error: "O conteúdo não pôde ser descriptografado." }, { status: 422 });
  }
}
