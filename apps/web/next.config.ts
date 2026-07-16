import type { NextConfig } from "next";

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

export default nextConfig;
