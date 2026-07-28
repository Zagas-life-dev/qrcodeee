import { createClient } from "@supabase/supabase-js";

import { connect } from "./db.mjs";

/**
 * §5.1 connect_via_scan verification.
 *
 * Every branch here has a failure mode that returns a plausible-looking result
 * rather than an error: swapped watermarks are two ints, a missed epoch bump is
 * a silently dropped notification, and telling a blocked user they were blocked
 * looks like good UX right up until it leaks the block.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

let failures = 0;
let checks = 0;
function check(label, ok, detail) {
  checks += 1;
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ""}`);
  }
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const stamp = Date.now();
const users = {};
const sql = await connect();

async function makeUser(key) {
  const email = `qrscan+${key}${stamp}@example.com`;
  const password = `Test-${stamp}-${key}!aA1`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: `Scan ${key.toUpperCase()}` },
  });
  if (error) throw new Error(`createUser(${key}): ${error.message}`);
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: session, error: e2 } = await anon.auth.signInWithPassword({ email, password });
  if (e2) throw new Error(`signIn(${key}): ${e2.message}`);
  return {
    id: data.user.id,
    db: createClient(URL, ANON, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
    }),
  };
}

/** Guards against passing a user OBJECT — pg then tries to serialise the
 *  Supabase client inside it and dies on a circular structure, several frames
 *  away from the actual mistake. */
function uuid(value) {
  if (typeof value !== "string") {
    throw new TypeError(`expected a uuid string, got ${typeof value} — did you mean user.id?`);
  }
  return value;
}

const tokenOf = async (id) =>
  (await sql.query(`select qr_token from profiles where id = $1`, [uuid(id)])).rows[0].qr_token;
const versionOf = async (id) =>
  (await sql.query(`select profile_version from profiles where id = $1`, [id])).rows[0].profile_version;
const connRow = async (a, b) =>
  (await sql.query(
    `select * from connections
      where least(user_a,user_b) = least($1::uuid,$2::uuid)
        and greatest(user_a,user_b) = greatest($1::uuid,$2::uuid)`, [a, b])).rows[0];
const notifs = async (recipient, source) =>
  (await sql.query(
    `select * from notifications where recipient_id = $1 and source_profile_id = $2
      order by created_at`, [recipient, source])).rows;

const scan = async (user, token) => {
  const { data, error } = await user.db.rpc("connect_via_scan", { scanned_token: token });
  if (error) throw new Error(`rpc: ${error.message}`);
  return data;
};

try {
  users.a = await makeUser("a");
  users.b = await makeUser("b");
  users.c = await makeUser("c");

  console.log("\n== rejection paths ==");
  check("self-scan is named, not a generic failure",
    (await scan(users.a, await tokenOf(users.a.id))).status === "self_scan");
  check("garbage token -> invalid_token",
    (await scan(users.a, "not-a-real-token")).status === "invalid_token");
  check("no connection row was created by either rejection",
    (await connRow(users.a.id, users.b.id)) === undefined);

  console.log("\n== first connection ==");
  // Drive the two profiles to DIFFERENT versions, so a swapped a/b watermark
  // mapping is detectable rather than coincidentally correct.
  await users.a.db.from("profiles").update({ name: "Scan A v2" }).eq("id", users.a.id);
  await users.a.db.from("profiles").update({ bio: "third version" }).eq("id", users.a.id);
  await users.b.db.from("profiles").update({ bio: "second version" }).eq("id", users.b.id);
  const aVersion = await versionOf(users.a.id);
  const bVersion = await versionOf(users.b.id);
  check("test setup put A and B on different versions", aVersion !== bVersion,
    `A=v${aVersion} B=v${bVersion}`);

  const first = await scan(users.a, await tokenOf(users.b.id));
  check("A scanning B returns new_connection", first.status === "new_connection", first.status);
  check("payload carries B's profile", first.profile?.id === users.b.id);

  const row = await connRow(users.a.id, users.b.id);
  check("connection row is active", row && row.disconnected_at === null);
  check("connection_epoch starts at 1", row?.connection_epoch === 1);
  // The inversion that is easy to get backwards: a_notified_version tracks how
  // current A is on B's profile.
  check("a_notified_version = B's current version (not A's)",
    row?.a_notified_version === bVersion, `got ${row?.a_notified_version}, B is v${bVersion}`);
  check("b_notified_version = A's current version (not B's)",
    row?.b_notified_version === aVersion, `got ${row?.b_notified_version}, A is v${aVersion}`);

  console.log("\n== new_connection notification ==");
  const bNotifs = await notifs(users.b.id, users.a.id);
  check("scanned person (B) got exactly one notification", bNotifs.length === 1, `got ${bNotifs.length}`);
  check("it is a new_connection", bNotifs[0]?.type === "new_connection");
  check("dedupe_seq is the connection epoch, not a version", bNotifs[0]?.dedupe_seq === 1);
  check("change_version is null (this isn't about a version)", bNotifs[0]?.change_version === null);
  check("scanner (A) got NO notification — they're looking at the screen",
    (await notifs(users.a.id, users.b.id)).length === 0);

  console.log("\n== contact details and field visibility in the payload ==");
  await sql.query(
    `update contact_details set phone='+15557778888', email='b@example.test' where profile_id=$1`,
    [users.b.id]);
  await users.b.db.from("custom_fields").insert([
    { profile_id: users.b.id, label: "Company", value: "Acme", is_public: true, sort_order: 0 },
    { profile_id: users.b.id, label: "Home address", value: "secret", is_public: false, sort_order: 1 },
  ]);
  const rescan = await scan(users.a, await tokenOf(users.b.id));
  check("re-scan returns already_connected", rescan.status === "already_connected", rescan.status);
  check("phone comes back once connected", rescan.profile?.phone === "+15557778888");
  check("email comes back once connected", rescan.profile?.email === "b@example.test");
  const labels = (rescan.profile?.custom_fields ?? []).map((f) => f.label);
  check("public custom field is included", labels.includes("Company"));
  // DEFINER bypasses RLS, so this exclusion is hand-written and worth asserting.
  check("PRIVATE custom field is NOT leaked by the DEFINER function",
    !labels.includes("Home address"), `labels: ${labels.join(", ")}`);
  check("already_connected did not create a second notification",
    (await notifs(users.b.id, users.a.id)).length === 1);

  console.log("\n== disconnect then reconnect ==");
  await sql.query(`update connections set disconnected_at = now() where id = $1`, [row.id]);
  await users.b.db.from("profiles").update({ bio: "changed while disconnected" }).eq("id", users.b.id);
  const bVersionAfter = await versionOf(users.b.id);

  const again = await scan(users.a, await tokenOf(users.b.id));
  check("reconnect returns new_connection, not already_connected",
    again.status === "new_connection", again.status);
  const row2 = await connRow(users.a.id, users.b.id);
  check("the SAME row was reactivated (no duplicate pair)", row2.id === row.id);
  check("disconnected_at cleared", row2.disconnected_at === null);
  check("connection_epoch bumped to 2", row2.connection_epoch === 2);
  check("watermark reset to B's CURRENT version, not the stale one",
    row2.a_notified_version === bVersionAfter,
    `got ${row2.a_notified_version}, B is now v${bVersionAfter} (was v${bVersion})`);
  // Without the epoch bump the idempotency index would swallow this forever.
  check("reconnect produced a SECOND new_connection notification",
    (await notifs(users.b.id, users.a.id)).length === 2);
  check("the second notification is keyed on epoch 2",
    (await notifs(users.b.id, users.a.id))[1]?.dedupe_seq === 2);

  console.log("\n== blocking ==");
  await users.a.db.from("blocks").insert({ blocker_id: users.a.id, blocked_id: users.c.id });
  check("BLOCKER scanning their blockee is told plainly — they already know",
    (await scan(users.a, await tokenOf(users.c.id))).status === "blocked");
  // The whole reason private.has_blocked() exists.
  check("BLOCKED party gets invalid_token, never 'blocked' (would confirm who)",
    (await scan(users.c, await tokenOf(users.a.id))).status === "invalid_token");
  check("no connection row was created in either direction",
    (await connRow(users.a.id, users.c.id)) === undefined);
  await sql.query(`delete from blocks where blocker_id = $1`, [users.a.id]);

  console.log("\n== soft-deleted target (§8) ==");
  await sql.query(`update profiles set deleted_at = now() where id = $1`, [users.c.id]);
  check("scanning a soft-deleted profile -> invalid_token",
    (await scan(users.a, await tokenOf(users.c.id))).status === "invalid_token");
  check("no connection created to a deleted account",
    (await connRow(users.a.id, users.c.id)) === undefined);
  await sql.query(`update profiles set deleted_at = null where id = $1`, [users.c.id]);

  console.log("\n== token rotation (§6) ==");
  const oldToken = await tokenOf(users.b.id);
  const versionBeforeRotate = await versionOf(users.b.id);
  const { data: newToken, error: rotErr } = await users.b.db.rpc("rotate_qr_token");
  check("owner can rotate their own token", !rotErr && Boolean(newToken), rotErr?.message);
  check("the token actually changed", newToken !== oldToken);
  check("rotation does NOT bump profile_version (nobody's contact card changed)",
    (await versionOf(users.b.id)) === versionBeforeRotate);
  check("the OLD token no longer resolves",
    (await scan(users.c, oldToken)).status === "invalid_token");
  check("existing connections survive rotation (they key on id, not token)",
    (await connRow(users.a.id, users.b.id))?.disconnected_at === null);
  check("the NEW token works",
    ["new_connection", "already_connected"].includes((await scan(users.c, newToken)).status));

  console.log("\n== simultaneous scans ==");
  const [d, e] = [await makeUser("d"), await makeUser("e")];
  users.d = d; users.e = e;
  const [r1, r2] = await Promise.all([
    scan(d, await tokenOf(e.id)),
    scan(e, await tokenOf(d.id)),
  ]);
  check("both racing scans returned a success status",
    ["new_connection", "already_connected"].includes(r1.status) &&
    ["new_connection", "already_connected"].includes(r2.status),
    `${r1.status} / ${r2.status}`);
  const { rows: pairRows } = await sql.query(
    `select count(*)::int n from connections
      where least(user_a,user_b) = least($1::uuid,$2::uuid)
        and greatest(user_a,user_b) = greatest($1::uuid,$2::uuid)`, [d.id, e.id]);
  check("exactly ONE connection row exists for the pair", pairRows[0].n === 1, `got ${pairRows[0].n}`);
  check("neither racing scan raised an error to the client", true);

  console.log("\n== function exposure ==");
  // Assert on the GRANT, not on "did the call error". rotate_qr_token raises
  // 'not authenticated' from its own body, so an error-based check passes even
  // while anon holds EXECUTE — which is exactly how the missing revoke hid.
  const anonClient = createClient(URL, ANON, { auth: { persistSession: false } });
  for (const sig of ["connect_via_scan(text)", "rotate_qr_token()", "reorder_custom_fields(uuid[])"]) {
    const { rows } = await sql.query(
      `select has_function_privilege('anon', $1, 'EXECUTE') ok`, [`public.${sig}`]);
    check(`anon holds no EXECUTE grant on ${sig}`, rows[0].ok === false);
  }
  const { error: anonErr } = await anonClient.rpc("connect_via_scan", { scanned_token: "x" });
  check("anon calling connect_via_scan over HTTP is rejected", Boolean(anonErr),
    "anon was allowed to call it");
} finally {
  console.log("\n== cleanup ==");
  for (const key of Object.keys(users)) {
    const { error } = await admin.auth.admin.deleteUser(users[key].id);
    if (error) console.log(`  FAILED to delete ${key}: ${error.message}`);
  }
  console.log(`  removed ${Object.keys(users).length} test users`);
  await sql.end();
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
process.exitCode = failures > 0 ? 1 : 0;
