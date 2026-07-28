import pg from "pg";

/**
 * Direct Postgres connection for admin scripts (migrations, verification).
 *
 * The application never uses this path — it talks to PostgREST so that RLS is
 * always in force. This connects as `postgres`, which bypasses RLS entirely, so
 * nothing here should ever be wired into a request handler.
 */
export async function connect() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Run with: node --env-file=.env.local scripts/<script>.mjs",
    );
  }

  // Try verified TLS first and only relax if the chain genuinely can't be
  // verified, rather than defaulting to rejectUnauthorized:false the way most
  // Supabase snippets do.
  for (const ssl of [true, { rejectUnauthorized: false }]) {
    const client = new pg.Client({ connectionString, ssl });
    try {
      await client.connect();
      if (ssl !== true) {
        console.warn(
          "  ! TLS certificate could not be verified; connected without verification.",
        );
      }
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      const isTlsFailure =
        error.code === "SELF_SIGNED_CERT_IN_CHAIN" ||
        error.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
        /certificate/i.test(error.message ?? "");
      if (ssl === true && isTlsFailure) continue;
      throw error;
    }
  }

  throw new Error("unreachable");
}

/**
 * Mints a scannable QR token for a profile (§6).
 *
 * Scripts used to read `profiles.qr_token`. That column is gone — codes are now
 * short-lived rows in `qr_tokens`, so every test that needs something to scan
 * has to mint one.
 *
 * Inserts directly rather than calling mint_qr_token(): that RPC derives its
 * owner from auth.uid(), and these scripts connect as `postgres` with no session
 * behind them. Pass a negative-looking interval to produce an already-expired
 * token for the tests that need one.
 */
export async function mintToken(sql, profileId, expiresIn = "15 minutes") {
  const { rows } = await sql.query(
    `insert into qr_tokens (profile_id, expires_at)
     values ($1, now() + $2::interval)
     returning token`,
    [profileId, expiresIn],
  );
  return rows[0].token;
}
