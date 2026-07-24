export function giveawayViewerUrl(siteUrl: string, publicSlug: string) {
  const url = new URL("/api/sorteios/oauth/iniciar", siteUrl);
  url.searchParams.set("slug", publicSlug);
  url.searchParams.set("modo", "visualizar");
  return url.toString();
}
