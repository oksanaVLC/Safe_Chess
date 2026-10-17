import type { NextConfig } from "next";
import { checkPublicConfig } from "./src/friend/publicConfig";

// Stop dev and build if the public Supabase settings hold a secret key, a
// JWT or a malformed value: NEXT_PUBLIC_* values are inlined into the
// browser bundle. Missing settings are fine: the robot modes need none, and
// Play with a friend then reports that it is unavailable.
const supabase = checkPublicConfig(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
if (supabase.status === "invalid") {
  throw new Error(`Safe Chess: ${supabase.error}. Fix .env.local before building.`);
}

const nextConfig: NextConfig = {
  // Fully static build: no server at runtime, so robot modes work offline
  // and the app can later be wrapped with Capacitor.
  output: "export",
};

export default nextConfig;
