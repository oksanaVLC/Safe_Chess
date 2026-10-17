// Safe Chess, friend mode: Deno entry point of the friend-move Edge Function.
// The logic is in handler.ts; this file only connects it to the runtime.
//
// Environment (injected by Supabase in the Edge Function runtime, never in
// the repo, .env files, NEXT_PUBLIC_* variables or the static build):
//   SUPABASE_URL; SUPABASE_PUBLISHABLE_KEYS ("default" entry), or the legacy
//   SUPABASE_ANON_KEY when it is absent; for the write, SUPABASE_SECRET_KEYS
//   ("default" entry, an sb_secret_ key, sent as apikey only), or the legacy
//   SUPABASE_SERVICE_ROLE_KEY (a service_role JWT) when it is absent. Server
//   credentials are read only when a move is written; see apiKeysFrom in
//   handler.ts.

import { apiKeysFrom, configErrorResponse, handleFriendMove } from "./handler.ts";

interface DenoRuntime {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): unknown;
}

const deno = (globalThis as unknown as { Deno: DenoRuntime }).Deno;

// Browser origins allowed to call this function. The production domain is
// added here when it is known, before the production deploy.
const ALLOWED_ORIGINS = ["http://localhost:3000"];

deno.serve((req) => {
  const supabaseUrl = deno.env.get("SUPABASE_URL");
  const keys = apiKeysFrom((name) => deno.env.get(name));
  const publishable = keys.publishable();
  if (!supabaseUrl || "error" in publishable) {
    // variable names only, never a value
    console.error(`friend-move: ${supabaseUrl ? (publishable as { error: string }).error : "SUPABASE_URL missing"}`);
    return configErrorResponse(req, ALLOWED_ORIGINS);
  }
  return handleFriendMove(req, {
    supabaseUrl,
    anonKey: publishable.key,
    serverCredentials: keys.server, // the handler logs a lookup error once and writes nothing
    allowedOrigins: ALLOWED_ORIGINS,
    fetch,
    now: Date.now,
  });
});
