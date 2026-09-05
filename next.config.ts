import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // SEC-14: explicit remote image hosts only. Never use a wildcard hostname here.
  // Add the admin upload host (F4) as a second entry once that provider is chosen.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.pexels.com",
        pathname: "/photos/**",
      },
    ],
  },
  typedRoutes: true,
  experimental: {
    typedEnv: false,
  },
};

export default nextConfig;
