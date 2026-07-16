import {
  inventoryImportFormatSchema,
  maskSecret,
  parseInventoryImport,
  uuidSchema,
} from "@godawp/domain";
import { z } from "zod";

import { authorizeAdminRequest } from "@/lib/api-auth";
import { readLimitedBody, RequestBodyTooLargeError } from "@/lib/http/limited-body";
import {
  fingerprintInventorySecret,
  protectInventorySecret,
} from "@/lib/inventory-security";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_CONTENT_LENGTH = 2 * 1024 * 1024;
const MAX_REQUEST_LENGTH = MAX_CONTENT_LENGTH + 64 * 1024;
const MAX_UNITS_PER_BATCH = 1_000;
const MAX_SECRET_LENGTH = 16_384;

const requestSchema = z.object({
  mode: z.enum(["preview", "commit"]),
  productId: uuidSchema,
  requestId: uuidSchema,
  format: inventoryImportFormatSchema,
  importMethod: z.enum(["manual", "txt", "csv"]).optional(),
  content: z.string().min(1).max(MAX_CONTENT_LENGTH),
  source: z.string().trim().max(255).nullable().optional(),
});

function rowsFromRpc(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) {
    return data.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
  }
  return data && typeof data === "object" ? [data as Record<string, unknown>] : [];
}

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("Pragma", "no-cache");
  return Response.json(body, { ...init, headers });
}

export async function POST(request: Request) {
  const authorization = await authorizeAdminRequest();
  if (!authorization.ok) return authorization.response;

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_LENGTH) {
    return noStoreJson(
      { error: "O conteúdo da importação deve ter no máximo 2 MB." },
      { status: 413, headers: { "Cache-Control": "no-store" } },
    );
  }

  let raw: unknown = null;
  try {
    const body = await readLimitedBody(request, MAX_REQUEST_LENGTH);
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return noStoreJson(
        { error: "O conteúdo da importação deve ter no máximo 2 MB." },
        { status: 413 },
      );
    }
  }
  const parsedRequest = requestSchema.safeParse(raw);
  if (!parsedRequest.success) {
    return noStoreJson(
      { error: "Dados de importação inválidos.", issues: z.treeifyError(parsedRequest.error) },
      { status: 400 },
    );
  }

  const payload = parsedRequest.data;
  const parsedImport = parseInventoryImport(payload.content, payload.format);
  const tooLong = parsedImport.entries.filter((entry) => entry.secret.length > MAX_SECRET_LENGTH);
  const tooMany = parsedImport.entries.length > MAX_UNITS_PER_BATCH;
  const baseIssues = [
    ...parsedImport.issues,
    ...tooLong.map((entry) => ({
      code: "secret_too_long",
      lineNumber: entry.lineNumber,
      message: `A unidade da linha ${entry.lineNumber} excede 16 KB.`,
    })),
    ...(tooMany
      ? [{ code: "batch_too_large", lineNumber: null, message: "Cada lote aceita até 1.000 unidades." }]
      : []),
  ];

  if (!parsedImport.valid || baseIssues.length > 0) {
    return noStoreJson(
      {
        valid: false,
        count: parsedImport.entries.length,
        issues: baseIssues,
        duplicates: parsedImport.duplicates,
      },
      { status: 422 },
    );
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return noStoreJson({ error: "Supabase não configurado." }, { status: 503 });

  let fingerprintRows: Array<{ lineNumber: number; fingerprint: string }>;
  try {
    fingerprintRows = parsedImport.entries.map((entry) => ({
      lineNumber: entry.lineNumber,
      fingerprint: fingerprintInventorySecret(entry.secret),
    }));
  } catch {
    return noStoreJson({ error: "As chaves de proteção do estoque são inválidas." }, { status: 503 });
  }

  const { data: existingData, error: existingError } = await supabase.rpc(
    "admin_check_inventory_fingerprints",
    { p_fingerprints: fingerprintRows.map((row) => row.fingerprint) },
  );
  if (existingError) {
    return noStoreJson({ error: "Não foi possível validar duplicidades no estoque." }, { status: 500 });
  }

  const existing = new Set(
    rowsFromRpc(existingData)
      .map((row) => row.fingerprint)
      .filter((value): value is string => typeof value === "string"),
  );
  const existingLines = fingerprintRows
    .filter((row) => existing.has(row.fingerprint))
    .map((row) => row.lineNumber);

  const preview = parsedImport.entries.map((entry) => ({
    lineNumber: entry.lineNumber,
    maskedSecret: maskSecret(entry.secret),
    duplicateInStock: existingLines.includes(entry.lineNumber),
  }));

  if (payload.mode === "preview") {
    return noStoreJson({
      valid: existingLines.length === 0,
      count: preview.length,
      entries: preview,
      existingDuplicateLines: existingLines,
      issues:
        existingLines.length > 0
          ? [{ code: "already_in_stock", lineNumber: null, message: "O lote contém unidades já cadastradas." }]
          : [],
    });
  }

  if (existingLines.length > 0) {
    return noStoreJson(
      { error: "O lote contém unidades já cadastradas.", existingDuplicateLines: existingLines },
      { status: 409 },
    );
  }

  let protectedUnits;
  try {
    protectedUnits = parsedImport.entries.map((entry) => {
      const secured = protectInventorySecret(entry.secret, payload.productId);
      return {
        encrypted_payload: secured.encrypted.ciphertext,
        iv: secured.encrypted.iv,
        auth_tag: secured.encrypted.authTag,
        fingerprint: secured.fingerprintBase64,
      };
    });
  } catch {
    return noStoreJson({ error: "Não foi possível proteger o lote de estoque." }, { status: 503 });
  }

  const importMethod = payload.importMethod ?? payload.format;
  const source = payload.source || (importMethod === "manual" ? "unidade-manual" : `importacao.${payload.format}`);
  const { data, error } = await supabase.rpc("admin_import_inventory_units", {
    p_product_id: payload.productId,
    p_source: source,
    p_import_method: importMethod,
    p_units: protectedUnits,
    p_request_id: payload.requestId,
  });

  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return noStoreJson(
      { error: status === 409 ? "O lote contém uma unidade duplicada." : "A importação não foi concluída." },
      { status },
    );
  }

  const result = rowsFromRpc(data)[0] ?? {};
  const reused = result.reused === true;
  return noStoreJson(
    {
      batchId: typeof result.batch_id === "string" ? result.batch_id : null,
      importedCount:
        typeof result.imported_count === "number" ? result.imported_count : protectedUnits.length,
      reused,
    },
    { status: reused ? 200 : 201 },
  );
}
