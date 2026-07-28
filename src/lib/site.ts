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
    throw new Error("NEXT_PUBLIC_SITE_URL is not set.");
  }
  return configured.replace(/\/+$/, "");
}

/** The URL a QR code encodes for a given token (§6). */
export function connectUrl(qrToken: string): string {
  return `${siteUrl()}/connect/${encodeURIComponent(qrToken)}`;
}
