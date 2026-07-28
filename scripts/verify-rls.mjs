import { createClient } from "@supabase/supabase-js";

import { connect } from "./db.mjs";

/**
 * Behavioural RLS verification against the real database, driven through
 * PostgREST as two real signed-in users — not through the postgres superuser,
 * which bypasses every policy and would pass no matter how broken they were.
 *
 * Kept out of `npm test` on purpose: it needs network, service-role credentials
 * and creates/deletes real auth users. Run it explicitly after a migration.
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
  const email = `qrtest+${key}${stamp}@example.com`;
  const password = `Test-${stamp}-${key}!aA1`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: `Test ${key.toUpperCase()}` },
  });
  if (error) throw new Error(`createUser(${key}): ${error.message}`);

  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: session, error: signInError } =
    await anon.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn(${key}): ${signInError.message}`);

  return {
    id: data.user.id,
    email,
    db: createClient(URL, ANON, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
    }),
  };
}

try {
  console.log("\n== signup trigger ==");
  users.a = await makeUser("a");
  users.b = await makeUser("b");

  const { rows: seeded } = await sql.query(
    `select p.id, p.name, p.profile_version,
            (cd.profile_id is not null) as has_contact_row
       from profiles p left join contact_details cd on cd.profile_id = p.id
      where p.id = any($1)`,
    [[users.a.id, users.b.id]],
  );
  check("handle_new_user created a profiles row for both users", seeded.length === 2);
  check("name came from Google full_name metadata",
    seeded.every((r) => r.name.startsWith("Test ")), seeded.map((r) => r.name).join(", "));
  check("contact_details row created empty at signup", seeded.every((r) => r.has_contact_row));
  check("new profiles start at version 1 (empty contact row must not fire an event)",
    seeded.every((r) => r.profile_version === 1),
    seeded.map((r) => `${r.name}=v${r.profile_version}`).join(", "));
  // §6: no permanent token exists to check any more. The equivalent property
  // is that minting produces distinct tokens per user.
  const { rows: minted } = await sql.query(
    `select profile_id, token from qr_tokens where profile_id = any($1)`,
    [[users.a.id, users.b.id]]);
  check("no QR token exists until one is minted", minted.length === 0);

  console.log("\n== profile updates work at all (SECURITY DEFINER triggers) ==");
  // If the change-event trigger functions lost SECURITY DEFINER, this fails —
  // profile_change_events has RLS on with zero policies.
  const { error: nameError } = await users.a.db
    .from("profiles").update({ name: "Test A Renamed" }).eq("id", users.a.id);
  check("user can rename their own profile", !nameError, nameError?.message);

  const { rows: ev } = await sql.query(
    `select version, changed_fields, is_major from profile_change_events
      where profile_id = $1 order by version`, [users.a.id]);
  check("rename produced exactly one change event", ev.length === 1, `got ${ev.length}`);
  check("rename is flagged MAJOR", ev[0]?.is_major === true);
  check("change event records field names only, no values",
    JSON.stringify(ev[0]?.changed_fields) === JSON.stringify(["name"]),
    JSON.stringify(ev[0]?.changed_fields));

  console.log("\n== column grants (RLS governs rows, not columns) ==");
  const denied = async (patch) => {
    const { error } = await users.a.db.from("profiles").update(patch).eq("id", users.a.id);
    return error;
  };
  check("cannot write profile_version", Boolean(await denied({ profile_version: 999999 })));
  // qr_token is gone; the equivalent is that qr_tokens is unreachable entirely.
  check("cannot read the qr_tokens table",
    ((await users.a.db.from("qr_tokens").select("token")).data ?? []).length === 0);
  check("cannot insert a chosen qr_tokens row",
    Boolean((await users.a.db.from("qr_tokens")
      .insert({ token: "chosen-value", profile_id: users.a.id,
                expires_at: new Date(Date.now() + 6e5).toISOString() })).error));
  check("cannot write deleted_at (would undo an account deletion)",
    Boolean(await denied({ deleted_at: null })));

  // photo_url IS client-writable by design, so the host allowlist is the only
  // thing between it and an <img src> beacon on a publicly readable profile.
  check("cannot point photo_url at an arbitrary host",
    Boolean(await denied({ photo_url: "https://evil.example/beacon.png" })));
  check("cannot smuggle a host past the anchor (googleusercontent.com.evil.test)",
    Boolean(await denied({ photo_url: "https://googleusercontent.com.evil.test/x.png" })));
  check("cannot use a different Cloudinary cloud",
    Boolean(await denied({ photo_url: "https://res.cloudinary.com/attacker/image/upload/x.png" })));
  check("CAN set a photo_url on our own Cloudinary cloud",
    !(await denied({ photo_url: "https://res.cloudinary.com/djm0gwdv/image/upload/f_auto/v1/qr-connect/avatars/user_x" })));
  check("CAN keep a Google OAuth avatar (handle_new_user seeds one)",
    !(await denied({ photo_url: "https://lh3.googleusercontent.com/a/ACg8ocK=s96-c" })));

  const { error: otherProfileError } = await users.a.db
    .from("profiles").update({ name: "hijacked" }).eq("id", users.b.id);
  const { rows: bName } = await sql.query(`select name from profiles where id = $1`, [users.b.id]);
  check("cannot rename someone else's profile",
    bName[0].name !== "hijacked", `B is now named "${bName[0].name}" (err: ${otherProfileError?.message ?? "none"})`);

  console.log("\n== contact_details are connection-gated ==");
  await sql.query(
    `update contact_details set phone = '+15550001111', email = 'b@example.com' where profile_id = $1`,
    [users.b.id]);

  const readsBContact = async () => {
    const { data } = await users.a.db
      .from("contact_details").select("phone, email").eq("profile_id", users.b.id);
    return data ?? [];
  };
  check("A cannot read B's phone/email before connecting", (await readsBContact()).length === 0);
  check("A CAN read B's public name/photo before connecting",
    ((await users.a.db.from("profiles").select("name").eq("id", users.b.id)).data ?? []).length === 1);

  // connect_via_scan doesn't exist yet (build step 3), so create the row directly.
  await sql.query(
    `insert into connections (user_a, user_b, a_notified_version, b_notified_version)
     values ($1, $2,
       (select profile_version from profiles where id = $2),
       (select profile_version from profiles where id = $1))`,
    [users.a.id, users.b.id]);

  check("A CAN read B's phone/email once connected", (await readsBContact()).length === 1);
  check("phone/email change fired a MAJOR event",
    (await sql.query(`select is_major from profile_change_events where profile_id = $1 and 'phone' = any(changed_fields)`,
      [users.b.id])).rows[0]?.is_major === true);

  console.log("\n== blocking is bidirectional — the direction that silently breaks ==");
  // A blocks B. The interesting assertion is about B, the party who did NOT
  // block: B can't see the `blocks` row proving it, so a policy that inlines a
  // blocks subquery leaves B with full visibility while looking correct.
  const { error: blockError } = await users.a.db
    .from("blocks").insert({ blocker_id: users.a.id, blocked_id: users.b.id });
  check("A can block B", !blockError, blockError?.message);

  check("BLOCKER side: A can no longer see B's profile",
    ((await users.a.db.from("profiles").select("id").eq("id", users.b.id)).data ?? []).length === 0);
  check("BLOCKED side: B can no longer see A's profile",
    ((await users.b.db.from("profiles").select("id").eq("id", users.a.id)).data ?? []).length === 0);
  check("BLOCKED side: B can no longer read A's contact_details",
    ((await users.b.db.from("contact_details").select("phone").eq("profile_id", users.a.id)).data ?? []).length === 0);
  check("BLOCKED side: B can no longer see the connection row",
    ((await users.b.db.from("connections").select("id")).data ?? []).length === 0);
  check("B cannot enumerate who blocked them",
    ((await users.b.db.from("blocks").select("blocker_id")).data ?? []).length === 0);

  await sql.query(`delete from blocks where blocker_id = $1`, [users.a.id]);
  check("unblocking restores visibility (connection row was never deleted)",
    ((await users.b.db.from("connections").select("id")).data ?? []).length === 1);

  console.log("\n== custom fields ==");
  const { error: cfError } = await users.a.db.from("custom_fields")
    .insert({ profile_id: users.a.id, label: "Company", value: "Acme", sort_order: 0 });
  check("owner can add a custom field", !cfError, cfError?.message);

  const { error: dupError } = await users.a.db.from("custom_fields")
    .insert({ profile_id: users.a.id, label: "company", value: "Other" });
  check("duplicate label blocked case-insensitively", dupError?.code === "23505", dupError?.code);

  const versionOf = async (id) =>
    (await sql.query(`select profile_version from profiles where id = $1`, [id])).rows[0].profile_version;

  const beforeReorder = await versionOf(users.a.id);
  await users.a.db.from("custom_fields").update({ sort_order: 5 }).eq("profile_id", users.a.id);
  check("reordering does NOT bump profile_version", (await versionOf(users.a.id)) === beforeReorder,
    `${beforeReorder} -> ${await versionOf(users.a.id)}`);

  // reorder_custom_fields is SECURITY INVOKER, so RLS is what scopes it. A
  // DEFINER version would silently become "reorder anybody's fields".
  await users.a.db.from("custom_fields")
    .insert({ profile_id: users.a.id, label: "Website", value: "example.com", sort_order: 1 });
  const idsOf = async (uid) =>
    ((await sql.query(
      `select id from custom_fields where profile_id = $1 order by sort_order`, [uid])).rows)
      .map((r) => r.id);

  const originalOrder = await idsOf(users.a.id);
  const reversed = [...originalOrder].reverse();
  const beforeRpc = await versionOf(users.a.id);

  const { error: reorderError } = await users.a.db
    .rpc("reorder_custom_fields", { field_ids: reversed });
  check("owner can reorder via the RPC", !reorderError, reorderError?.message);
  check("RPC actually persisted the new order",
    JSON.stringify(await idsOf(users.a.id)) === JSON.stringify(reversed));
  check("RPC reorder does NOT bump profile_version (no notification fan-out)",
    (await versionOf(users.a.id)) === beforeRpc);

  const { error: foreignReorderError } = await users.b.db
    .rpc("reorder_custom_fields", { field_ids: [...reversed].reverse() });
  check("B's reorder of A's fields is a silent no-op, not an error",
    !foreignReorderError, foreignReorderError?.message);
  check("A's order is untouched by B's attempt",
    JSON.stringify(await idsOf(users.a.id)) === JSON.stringify(reversed));

  await users.a.db.from("custom_fields")
    .insert({ profile_id: users.a.id, label: "Secret", value: "hidden", is_public: false });
  const beforePrivateEdit = await versionOf(users.a.id);
  await users.a.db.from("custom_fields")
    .update({ value: "still hidden" }).eq("profile_id", users.a.id).eq("label", "Secret");
  check("editing an always-private field does NOT bump profile_version",
    (await versionOf(users.a.id)) === beforePrivateEdit);

  check("B cannot see A's private custom field",
    !((await users.b.db.from("custom_fields").select("label").eq("profile_id", users.a.id)).data ?? [])
      .some((r) => r.label === "Secret"));
  check("B CAN see A's public custom field",
    ((await users.b.db.from("custom_fields").select("label").eq("profile_id", users.a.id)).data ?? [])
      .some((r) => r.label === "Company"));

  // Bulk-insert to the cap using the owner's own client, so the trigger is what stops it.
  const rows = Array.from({ length: 25 }, (_, i) => ({
    profile_id: users.a.id, label: `Field ${i}`, value: "x", sort_order: i,
  }));
  let limitHit = null;
  for (const row of rows) {
    const { error } = await users.a.db.from("custom_fields").insert(row);
    if (error) { limitHit = error; break; }
  }
  const { rows: cfCount } = await sql.query(
    `select count(*)::int n from custom_fields where profile_id = $1`, [users.a.id]);
  check("custom field limit enforced in the DB, not the app", Boolean(limitHit), "no error raised");
  check("cap held at exactly 20", cfCount[0].n === 20, `got ${cfCount[0].n}`);

  console.log("\n== push subscriptions ==");
  const ENDPOINT = `https://push.example.test/sub/${stamp}`;
  const register = (user) =>
    user.db.rpc("upsert_push_subscription", {
      p_endpoint: ENDPOINT,
      p_p256dh: "test-p256dh-key",
      p_auth: "test-auth-key",
      p_user_agent: "verify-rls",
    });
  const ownerOf = async (endpoint) =>
    (await sql.query(`select profile_id from push_subscriptions where endpoint = $1`, [endpoint]))
      .rows[0]?.profile_id;

  const { error: regError } = await register(users.a);
  check("owner can register a push subscription", !regError, regError?.message);
  check("it is stored against the caller", (await ownerOf(ENDPOINT)) === users.a.id);

  const { error: reRegError } = await register(users.a);
  check("re-registering the same endpoint is idempotent", !reRegError, reRegError?.message);
  check("still exactly one row for the endpoint",
    (await sql.query(`select count(*)::int n from push_subscriptions where endpoint = $1`, [ENDPOINT]))
      .rows[0].n === 1);

  // The case a plain client upsert cannot handle: the endpoint identifies one
  // browser install, so a shared device signing in as B must MOVE it off A —
  // otherwise A keeps receiving that device's notifications forever.
  const { error: moveError } = await register(users.b);
  check("a device switching accounts moves the endpoint", !moveError, moveError?.message);
  check("the endpoint now belongs to B, not A", (await ownerOf(ENDPOINT)) === users.b.id);
  check("and did not duplicate",
    (await sql.query(`select count(*)::int n from push_subscriptions where endpoint = $1`, [ENDPOINT]))
      .rows[0].n === 1);

  check("A can no longer see that subscription",
    ((await users.a.db.from("push_subscriptions").select("id")).data ?? []).length === 0);
  check("B can see their own",
    ((await users.b.db.from("push_subscriptions").select("id")).data ?? []).length === 1);
  check("B can delete their own subscription",
    !(await users.b.db.from("push_subscriptions").delete().eq("endpoint", ENDPOINT)).error);

  console.log("\n== tables with no client access ==");
  check("client cannot read profile_change_events",
    ((await users.a.db.from("profile_change_events").select("id")).data ?? []).length === 0);
  check("client cannot INSERT into connections directly",
    Boolean((await users.a.db.from("connections")
      .insert({ user_a: users.a.id, user_b: users.b.id, a_notified_version: 1, b_notified_version: 1 })).error));
  check("client cannot INSERT a notification for themselves",
    Boolean((await users.a.db.from("notifications")
      .insert({ recipient_id: users.a.id, source_profile_id: users.b.id, type: "new_connection", dedupe_seq: 1 })).error));

  console.log("\n== PostgREST does not expose the private schema ==");
  const rpc = await fetch(`${URL}/rest/v1/rpc/is_blocked`, {
    method: "POST",
    headers: {
      apikey: ANON, Authorization: `Bearer ${ANON}`,
      "Content-Type": "application/json", "Content-Profile": "private",
    },
    body: JSON.stringify({ a: users.a.id, b: users.b.id }),
  });
  const rpcBody = await rpc.text();
  check("private schema is not reachable over HTTP (would be a social-graph oracle)",
    rpc.status >= 400, `HTTP ${rpc.status}: ${rpcBody.slice(0, 200)}`);

  const rpcPublic = await fetch(`${URL}/rest/v1/rpc/is_blocked`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify({ a: users.a.id, b: users.b.id }),
  });
  check("is_blocked is not exposed in the public schema either", rpcPublic.status >= 400,
    `HTTP ${rpcPublic.status}`);

  console.log("\n== hard-erasure cascade (§8's separate GDPR pipeline) ==");
  // Deleting auth.users cascades to profiles and on to custom_fields /
  // contact_details, whose DELETE triggers then try to UPDATE the profile row
  // that is mid-delete. If they don't handle the resulting NULL, the whole
  // erasure aborts on a NOT NULL violation and the pipeline cannot complete.
  // A is loaded up with 20 custom fields and a contact row by this point.
  let cascadeError = null;
  try {
    await sql.query("begin");
    await sql.query(`delete from auth.users where id = $1`, [users.a.id]);
    await sql.query("rollback");
  } catch (error) {
    await sql.query("rollback").catch(() => {});
    cascadeError = error;
  }
  check("hard-deleting a fully populated account cascades cleanly",
    !cascadeError, cascadeError && `${cascadeError.message}\n          at ${cascadeError.where}`);
} finally {
  console.log("\n== cleanup ==");
  for (const key of Object.keys(users)) {
    const { error } = await admin.auth.admin.deleteUser(users[key].id);
    console.log(`  deleted test user ${key}${error ? ` (FAILED: ${error.message})` : ""}`);
  }
  await sql.end();
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
process.exitCode = failures > 0 ? 1 : 0;
