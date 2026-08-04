import type { NextConfig } from "next";
import { withMicrofrontends } from "@vercel/microfrontends/next/config";

const nextConfig: NextConfig = {
  transpilePackages: ["@godawp/domain"],
  // The Discord adapter includes optional Gateway compression modules. Keep it
  // as a native Node dependency; this bot only uses signed HTTP Interactions.
  serverExternalPackages: ["@chat-adapter/discord"],
  poweredByHeader: false,
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

// Vercel injects the group's microfrontends configuration during GWStore
// builds. Local commands and standalone store deployments do not use it.
export default process.env.VERCEL === "1" && isGwStoreDeployment
  ? withMicrofrontends(nextConfig)
  : nextConfig;
