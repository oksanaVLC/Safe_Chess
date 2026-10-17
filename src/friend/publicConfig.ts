// The only Supabase settings the browser ever gets: the project URL and the
// publishable key, both public by design (data is protected by RLS and the
// database functions, not by hiding them). They come from
// NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, set in
// .env.local (never committed) and inlined into the static build.
//
// No dependencies: next.config.ts imports this file to stop a build that
// would ship a secret key or a JWT to the browser.

export type PublicConfig =
  | { status: "ok"; url: string; publishableKey: string }
  | { status: "missing" }
  | { status: "invalid"; error: string };

const URL_RE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;

/** Checks the two public settings. Errors name the variable, never a value. */
export function checkPublicConfig(url: string | undefined, key: string | undefined): PublicConfig {
  const u = url?.trim() ?? "";
  const k = key?.trim() ?? "";
  if (u === "" && k === "") return { status: "missing" };
  // the dangerous mistakes first: they must never reach the browser
  if (k.startsWith("sb_secret_")) {
    return { status: "invalid", error: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a SECRET key" };
  }
  if (k.split(".").length === 3) {
    return { status: "invalid", error: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a JWT, not a publishable key" };
  }
  if (!k.startsWith("sb_publishable_")) {
    return { status: "invalid", error: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must start with sb_publishable_" };
  }
  if (!URL_RE.test(u)) {
    return { status: "invalid", error: "NEXT_PUBLIC_SUPABASE_URL must be https://<project-ref>.supabase.co" };
  }
  return { status: "ok", url: u, publishableKey: k };
}
