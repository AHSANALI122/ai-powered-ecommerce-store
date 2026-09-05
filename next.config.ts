import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // SEC-14: explicit remote image hosts only. Never use a bare wildcard here —
  // `**` as the whole hostname would let any URL stored on a product row be
  // proxied by the image optimizer, which is the SSRF this list exists to stop.
  // The Blob entry wildcards only the store-id label of a fixed Vercel suffix,
  // which is as narrow as that host can be expressed.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.pexels.com",
        pathname: "/photos/**",
      },
      {
        // Admin uploads when IMAGE_STORE=blob (F4).
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
        pathname: "/**",
      },
    ],
  },
  typedRoutes: true,
  experimental: {
    typedEnv: false,
  },
};

export default nextConfig;
