import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const deployment = process.argv.includes("--deployment");
if (!deployment || process.env.VERCEL_ENV === "production") {
  const projectDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
  const cacheDirectory = join(projectDirectory, ".next");
  await mkdir(cacheDirectory, { recursive: true });
  const outputDirectory = await mkdtemp(join(cacheDirectory, "discord-storefront-repair-"));
  try {
    // Bundle the local TS/TSX graph as ESM: Chat SDK has import-only exports.
    // Splitting keeps optional image processing inside its lazy import.
    await build({
      absWorkingDir: projectDirectory,
      entryPoints: ["scripts/repair-discord-storefronts.ts"],
      outdir: outputDirectory,
      outExtension: { ".js": ".mjs" },
      bundle: true,
      splitting: true,
      platform: "node",
      target: "node22",
      format: "esm",
      packages: "external",
    });
    await import(pathToFileURL(join(outputDirectory, "repair-discord-storefronts.mjs")).href);
  } catch (error) {
    console.error("[discord-storefronts:repair]", error instanceof Error ? error.message : "failed");
    if (!deployment) process.exitCode = 1;
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
}
