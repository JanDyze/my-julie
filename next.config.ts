import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-only: lets phones on the LAN load /_next/* assets from the dev server.
  allowedDevOrigins: ["192.168.1.16", "192.168.1.*"],
};

export default nextConfig;
