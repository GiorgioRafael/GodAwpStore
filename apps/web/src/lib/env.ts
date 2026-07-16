import "server-only";

export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
};

export type SupabaseServerConfig = SupabasePublicConfig & {
  serviceRoleKey: string;
};

export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) {
    return null;
  }

  return { url, publishableKey };
}

export function getSupabaseServerConfig(): SupabaseServerConfig | null {
  const publicConfig = getSupabasePublicConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!publicConfig || !serviceRoleKey) {
    return null;
  }

  return { ...publicConfig, serviceRoleKey };
}

export function getSiteUrl(requestOrigin?: string): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (process.env.NODE_ENV === "production") {
    if (!configured) throw new Error("NEXT_PUBLIC_SITE_URL não configurada em produção.");
    const productionUrl = new URL(configured);
    if (productionUrl.protocol !== "https:") {
      throw new Error("NEXT_PUBLIC_SITE_URL deve usar HTTPS em produção.");
    }
    return productionUrl.origin;
  }
  const candidates = [
    configured,
    requestOrigin,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
    } catch {
      // Try the next fail-closed candidate.
    }
  }

  return "http://localhost:3000";
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseServerConfig() !== null;
}
