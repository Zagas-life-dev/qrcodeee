import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

/**
 * `NEXT_PUBLIC_*` values are inlined into the bundle by `next build`, not read
 * from the environment at runtime. A missing one therefore does **not** fail the
 * deploy — it bakes `undefined` into the output and fails much later, on the
 * first request that needs it, as an opaque digest in the Vercel logs with no
 * message attached. (Setting the variable in the dashboard afterwards changes
 * nothing until the next build, which is its own hour of confusion.)
 *
 * Fail the build instead. A red deploy that names the variable costs a minute;
 * the runtime version of this cost a production sign-in outage.
 */
const REQUIRED_AT_BUILD = [
  // Every request goes through src/proxy.ts, which constructs a Supabase client
  // from these two. Without them the whole site 500s, not just one route.
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  // OAuth `redirectTo` (§5.1) and the QR payload URL (§6) are both built from
  // this. Deliberately not derived from request headers — see src/lib/site.ts.
  "NEXT_PUBLIC_SITE_URL",
];

/** Degrades gracefully when unset, so it's a warning rather than a failure. */
const OPTIONAL_AT_BUILD = ["NEXT_PUBLIC_VAPID_PUBLIC_KEY"];

function assertBuildEnv() {
  const missing = REQUIRED_AT_BUILD.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required build-time environment ${
        missing.length === 1 ? "variable" : "variables"
      }: ${missing.join(", ")}.\n` +
        "These are NEXT_PUBLIC_*, so they are read when the build runs, not when " +
        "the server does. On Vercel set them under Settings -> Environment " +
        "Variables for the Production environment, then redeploy — adding them " +
        "without a redeploy has no effect.",
    );
  }

  const absent = OPTIONAL_AT_BUILD.filter((name) => !process.env[name]);
  if (absent.length > 0) {
    console.warn(
      `[env] ${absent.join(", ")} not set — web push will report itself as ` +
        "unsupported and no notifications will be delivered (§5.2).",
    );
  }
}

const nextConfig: NextConfig = {
  /**
   * Cache Components (site-spec S12). Enables `use cache` / `cacheLife` /
   * `cacheTag`, and makes Partial Prerendering the default on every route.
   *
   * Enabled for /u/{handle}: it is the only anonymous, high-traffic route in the
   * product, and PPR is what lets its public shell be cached while the
   * viewer-dependent half — the block check, contact details — stays dynamic.
   * That split is a security boundary before it is a performance one, and this
   * flag is what makes the framework enforce it rather than review.
   *
   * Turned on NOW rather than at launch because it changes rendering defaults
   * app-wide: doing it against a dozen routes is a different job from doing it
   * against fifty.
   *
   * NOTE ON DURABILITY: `use cache` defaults to in-memory storage, so entries
   * are scoped to one serverless instance and one deployment. That is fine for
   * collapsing duplicate work within a request and across a warm instance, and
   * it is NOT a CDN. If the public page's hit rate matters later, that is what
   * `use cache: remote` or a cache handler is for — a deliberate step with a
   * platform cost attached, not something to assume is already happening.
   */
  cacheComponents: true,

  experimental: {
    /**
     * Native page transitions via React's <ViewTransition>, which is the whole
     * reason this app needs no animation library. Where the browser doesn't
     * support the View Transitions API the navigation simply doesn't animate —
     * it never breaks, so there is no fallback to maintain.
     */
    viewTransition: true,
  },
};

export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD) assertBuildEnv();
  return nextConfig;
}
