import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  async rewrites() {
    return [
      {
        source: "/socket.io/:path*",
        destination: "http://127.0.0.1:3033/socket.io/:path*",
      },
    ];
  },
};

export default nextConfig;
