import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ibb.co" },
      { protocol: "https", hostname: "**.imgbb.com" },
      { protocol: "https", hostname: "iili.io" },
      { protocol: "https", hostname: "**.iili.io" },
      { protocol: "https", hostname: "freeimage.host" },
      { protocol: "https", hostname: "**.freeimage.host" },
      { protocol: "https", hostname: "img.youtube.com" },
      // IPFS gateways
      { protocol: "https", hostname: "ipfs.io" },
      { protocol: "https", hostname: "gateway.pinata.cloud" },
      { protocol: "https", hostname: "gateway.pinata.cloud" },
      { protocol: "https", hostname: "**.mypinata.cloud" },
      { protocol: "https", hostname: "cloudflare-ipfs.com" },
    ],
  },
  async headers() {
    return [
      {
        // CORS headers for actions.json (Solana Actions spec requirement)
        source: "/actions.json",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, Content-Encoding, Accept-Encoding" },
        ],
      },
      {
        // CORS headers for all Action API routes
        source: "/api/actions/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,POST,PUT,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, Content-Encoding, Accept-Encoding" },
        ],
      },
    ];
  },
};

export default nextConfig;
