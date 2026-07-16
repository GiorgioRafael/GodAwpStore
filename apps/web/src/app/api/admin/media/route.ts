import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { authorizeAdminRequest } from "@/lib/api-auth";
import { readLimitedBody, RequestBodyTooLargeError } from "@/lib/http/limited-body";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const BUCKET = "catalog-media";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_MULTIPART_SIZE = MAX_FILE_SIZE + 64 * 1024;
const MAX_DELETE_BODY_SIZE = 8 * 1024;
const ALLOWED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function safeFolder(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return "catalog";
  const normalized = value.toLowerCase().replace(/[^a-z0-9-]/g, "");
  return ["games", "substores", "products"].includes(normalized) ? normalized : "catalog";
}

function requestId(request: Request): string {
  const value = request.headers.get("idempotency-key")?.trim();
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : randomUUID();
}

async function hasExpectedSignature(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (file.type === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (file.type === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((value, index) => bytes[index] === value);
  }
  if (file.type === "image/webp") {
    return (
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
    );
  }
  return false;
}

export async function POST(request: NextRequest) {
  const authorization = await authorizeAdminRequest();
  if (!authorization.ok) return authorization.response;

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MULTIPART_SIZE) {
    return NextResponse.json({ error: "A imagem deve ter no máximo 5 MB." }, { status: 413 });
  }

  let formData: FormData;
  try {
    const body = await readLimitedBody(request, MAX_MULTIPART_SIZE);
    const requestBody = new ArrayBuffer(body.byteLength);
    new Uint8Array(requestBody).set(body);
    formData = await new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: requestBody,
    }).formData();
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "A imagem deve ter no máximo 5 MB." }, { status: 413 });
    }
    return NextResponse.json({ error: "Formulário de imagem inválido." }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Selecione uma imagem." }, { status: 400 });
  }

  const extension = ALLOWED_TYPES.get(file.type);
  if (!extension) {
    return NextResponse.json({ error: "Use uma imagem JPG, PNG ou WebP." }, { status: 415 });
  }
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "A imagem deve ter no máximo 5 MB." }, { status: 413 });
  }
  if (!(await hasExpectedSignature(file))) {
    return NextResponse.json(
      { error: "O conteúdo do arquivo não corresponde a uma imagem JPG, PNG ou WebP válida." },
      { status: 415 },
    );
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase não configurado." }, { status: 503 });
  }

  const path = `${safeFolder(formData.get("folder"))}/${requestId(request)}.${extension}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    cacheControl: "31536000",
    contentType: file.type,
    upsert: false,
  });

  if (error) {
    const statusCode = Number((error as { statusCode?: string | number }).statusCode ?? 0);
    if (statusCode === 409) {
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      return NextResponse.json({ path, publicUrl: data.publicUrl, reused: true });
    }
    return NextResponse.json({ error: "Não foi possível salvar a imagem." }, { status: 500 });
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);

  return NextResponse.json({ path, publicUrl: data.publicUrl, reused: false }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const authorization = await authorizeAdminRequest();
  if (!authorization.ok) return authorization.response;

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DELETE_BODY_SIZE) {
    return NextResponse.json({ error: "Solicitação muito grande." }, { status: 413 });
  }

  let body: unknown = null;
  try {
    const rawBody = await readLimitedBody(request, MAX_DELETE_BODY_SIZE);
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody)) as unknown;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "Solicitação muito grande." }, { status: 413 });
    }
  }
  const path =
    body && typeof body === "object" && "path" in body && typeof body.path === "string"
      ? body.path
      : null;

  if (
    !path ||
    !/^(catalog|games|substores|products)\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/i.test(path)
  ) {
    return NextResponse.json({ error: "Caminho de imagem inválido." }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase não configurado." }, { status: 503 });
  }

  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) {
    return NextResponse.json({ error: "Não foi possível remover a imagem." }, { status: 500 });
  }

  return new Response(null, { status: 204 });
}
