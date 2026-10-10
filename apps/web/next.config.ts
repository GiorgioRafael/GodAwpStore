import type { NextConfig } from "next";
import { gwStoreRailwayRewrites, gwStoreRailwayServerActionOrigins } from "./src/lib/railway-bridge";

const railwayServerActionOrigins = gwStoreRailwayServerActionOrigins();

const nextConfig: NextConfig = {
  transpilePackages: ["@godawp/domain"],
  // The Discord adapter includes optional Gateway compression modules. Keep it
  // as a native Node dependency; this bot only uses signed HTTP Interactions.
  serverExternalPackages: ["@chat-adapter/discord"],
  poweredByHeader: false,
  ...(railwayServerActionOrigins ? {
    experimental: { serverActions: { allowedOrigins: railwayServerActionOrigins } },
  } : {}),
  async rewrites() {
    // beforeFiles also forwards _next assets from the current Railway build.
    // Host conditions keep the 101Devs microfrontend and THStore on Vercel.
    return { beforeFiles: gwStoreRailwayRewrites(), afterFiles: [], fallback: [] };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
      {
        source: "/pagamento/pix/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
      {
        protocol: "https",
        hostname: "cdn.discordapp.com",
      },
    ],
  },
};

// Only GWStore belongs to the 101Devs microfrontend group. Other branded
// deployments (such as Loja TH) use the same application as standalone sites.
const isGwStoreDeployment =
  (process.env.NEXT_PUBLIC_STORE_NAME?.trim().toLocaleLowerCase("en-US") || "gwstore") ===
  "gwstore";

// Type generation only scans this application's routes. Vercel's native
// typecheck sandbox does not receive the group's routing configuration.
const isTypeGeneration = process.argv[2] === "typegen";

// Keep the group's asset routing for actual GWStore builds and servers.
export default async function configureNext(): Promise<NextConfig> {
  if (process.env.VERCEL === "1" && isGwStoreDeployment && !isTypeGeneration) {
    // Railway startup can prune this Vercel build helper and its glob dependencies.
    const { withMicrofrontends } = await import("@vercel/microfrontends/next/config");
    return withMicrofrontends(nextConfig);
  }
  return nextConfig;
}
