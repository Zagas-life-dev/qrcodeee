/**
 * The app's public origin, without a trailing slash.
 *
 * Read from config rather than derived from request headers on purpose. The
 * OAuth `redirectTo` and the QR payload URL (§6) are both built from this, and
 * both are values an attacker would love to influence — `Host`/`X-Forwarded-Host`
 * are client-controlled, config is not.
 */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (!configured) {
    // Being a NEXT_PUBLIC_ value, this is decided at `next build` and frozen
    // into the bundle — so "it's set in the dashboard" and "it's set in this
    // deployment" are different claims, and only the second one matters.
    // next.config.ts fails the build on this; reaching here means the running
    // bundle predates that check.
    throw new Error(
      "NEXT_PUBLIC_SITE_URL is not set in this build. Set it on the Production " +
        "environment and redeploy — setting it without rebuilding has no effect.",
    );
  }
  return configured.replace(/\/+$/, "");
}

/**
 * The URL a QR code encodes (§6).
 *
 * THE DESTINATION IS THE PERSON'S PUBLIC PAGE, and the token rides along as a
 * query parameter. Two reasons, in order of weight:
 *
 *   1. It is where the scanner ends up anyway. `src/proxy.ts` rewrites this to
 *      the redemption route, which connects and then redirects back here with
 *      the token stripped. Encoding the destination rather than the machinery
 *      means the URL in the code is the URL in the address bar.
 *   2. A plain camera app shows the raw URL before opening it. "qr.app/u/ada"
 *      is something a person can recognise and choose to open;
 *      "qr.app/connect/9f8c1b2a-…" is not.
 *
 * THE HANDLE IS DECORATION AND THE TOKEN IS THE CREDENTIAL. Nothing downstream
 * trusts the handle in this URL — `connect_via_scan` resolves the token to a
 * profile and the redirect uses THAT profile's handle, so a hand-crafted code
 * naming someone else connects you to whoever the token belongs to and sends
 * you to their page. See the redemption route.
 */
export function connectUrl(qrToken: string, handle: string): string {
  return `${siteUrl()}/u/${encodeURIComponent(handle)}?c=${encodeURIComponent(qrToken)}`;
}
