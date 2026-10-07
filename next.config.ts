import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fully static build: no server at runtime, so robot modes work offline
  // and the app can later be wrapped with Capacitor.
  output: "export",
};

export default nextConfig;
