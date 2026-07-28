import { createClient } from "@supabase/supabase-js";

import { connect, mintToken } from "./db.mjs";

/**
 * §8 account deletion and retention verification.
 *
 * The headline assertion is the quiet one: deleting an account must produce NO
 * change events. Every step of the deletion looks like an ordinary profile edit
 * to the triggers, so without the suppression flag it fans out "they changed
 * their phone and email" to every connection the user ever had — and offers each
 * of them the one-tap "Update phone contact" action that rewrites their address
 * book entry to read "Deleted account".
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
  const email = `qrdel+${key}${stamp}@example.com`;
  const password = `Test-${stamp}-${key}!aA1`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: `Del ${key.toUpperCase()}` },
  });
  if (error) throw new Error(`createUser(${key}): ${error.message}`);
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: session } = await anon.auth.signInWithPassword({ email, password });
  return {
    id: data.user.id, email, password,
    db: createClient(URL, ANON, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
    }),
  };
}

const one = async (q, p) => (await sql.query(q, p)).rows[0];
const count = async (table, col, id) =>
  (await sql.query(`select count(*)::int n from ${table} where ${col} = $1`, [id])).rows[0].n;

try {
  users.a = await makeUser("a"); // the one who deletes
  users.b = await makeUser("b"); // their connection

  await users.a.db.rpc("connect_via_scan", {
    scanned_token: await mintToken(sql, users.b.id),
  });

  // Give A a full profile so deletion has something to actually remove.
  await sql.query(
    `update contact_details set phone='+15559998888', email='a@example.test' where profile_id=$1`,
    [users.a.id]);
  await users.a.db.from("custom_fields").insert([
    { profile_id: users.a.id, label: "Company", value: "Acme", is_public: true, sort_order: 0 },
    { profile_id: users.a.id, label: "Private note", value: "secret", is_public: false, sort_order: 1 },
  ]);
  await sql.query(
    `insert into push_subscriptions (profile_id, endpoint, p256dh, auth)
     values ($1, $2, 'k', 'k')`, [users.a.id, `https://push.test/${stamp}`]);
  await users.a.db.from("blocks").insert({ blocker_id: users.a.id, blocked_id: users.b.id });
  await sql.query(`delete from blocks where blocker_id = $1`, [users.a.id]);

  // A live token for A, so deletion can be shown to kill outstanding codes.
  const oldToken = await mintToken(sql, users.a.id);
  const connectionId = (await one(
    `select id from connections where user_a=$1 or user_b=$1`, [users.a.id])).id;

  // Clear the slate so any event seen after this point came from the deletion.
  await sql.query(`delete from profile_change_events where profile_id = $1`, [users.a.id]);
  await sql.query(`delete from rate_events where actor_id = $1`, [users.a.id]);
  const notifsBefore = await count("notifications", "recipient_id", users.b.id);

  console.log("\n== deletion ==");
  const { error: delError } = await users.a.db.rpc("delete_my_account");
  check("delete_my_account succeeds", !delError, delError?.message);

  const profile = await one(
    `select name, photo_url, bio, deleted_at from profiles where id=$1`, [users.a.id]);
  check("the profiles row SURVIVES (it is the placeholder)", Boolean(profile));
  check("deleted_at is set", profile.deleted_at !== null);
  check("name scrubbed to 'Deleted account'", profile.name === "Deleted account", profile.name);
  check("photo cleared", profile.photo_url === null);
  check("bio cleared", profile.bio === null);
  check("every outstanding QR token deleted, so no code resolves any more",
    (await count("qr_tokens", "profile_id", users.a.id)) === 0);

  console.log("\n== private data is actually gone ==");
  check("contact_details deleted", (await count("contact_details", "profile_id", users.a.id)) === 0);
  check("custom_fields deleted", (await count("custom_fields", "profile_id", users.a.id)) === 0);
  check("push subscriptions deleted", (await count("push_subscriptions", "profile_id", users.a.id)) === 0);
  check("their own notification inbox deleted",
    (await count("notifications", "recipient_id", users.a.id)) === 0);

  console.log("\n== the quiet part: no fan-out ==");
  // Without `set_config('app.suppress_change_events','on',true)` as the first
  // statement, this is where a major "they changed their phone and email" event
  // and a "they changed their name" event would appear.
  check("deletion produced ZERO change events",
    (await count("profile_change_events", "profile_id", users.a.id)) === 0,
    `${await count("profile_change_events", "profile_id", users.a.id)} events written`);
  check("the connection received no new notification",
    (await count("notifications", "recipient_id", users.b.id)) === notifsBefore,
    `was ${notifsBefore}, now ${await count("notifications", "recipient_id", users.b.id)}`);
  check("the bulk delete did not burn rate-limit budget either",
    (await count("rate_events", "actor_id", users.a.id)) === 0);

  console.log("\n== the placeholder works for everyone else ==");
  const conn = await one(`select disconnected_at from connections where id=$1`, [connectionId]);
  check("the connection is left ACTIVE (§8 step 5 decision)", conn.disconnected_at === null);
  const visible = (await users.b.db.from("profiles").select("name, deleted_at").eq("id", users.a.id)).data ?? [];
  check("B can still READ the profile row — no broken reference", visible.length === 1);
  check("B sees the placeholder name", visible[0]?.name === "Deleted account");
  check("B can tell it is deleted, to render it differently", visible[0]?.deleted_at !== null);
  check("B can no longer read their contact details",
    ((await users.b.db.from("contact_details").select("phone").eq("profile_id", users.a.id)).data ?? []).length === 0);

  console.log("\n== a deleted account cannot be scanned or reused ==");
  const scanOld = await users.b.db.rpc("connect_via_scan", { scanned_token: oldToken });
  check("the token that was live at deletion time is dead",
    scanOld.data?.status === "invalid_token", scanOld.data?.status);
  // Belt and braces: even if a row somehow survived, deleted_at must stop it.
  const scanForced = await users.b.db.rpc("connect_via_scan",
    { scanned_token: await mintToken(sql, users.a.id) });
  check("a token minted for a deleted account still cannot be scanned",
    scanForced.data?.status === "invalid_token", scanForced.data?.status);

  console.log("\n== auth record is preserved, not cascaded ==");
  const authRow = await one(`select id from auth.users where id=$1`, [users.a.id]);
  check("auth.users row still exists (deleting it would cascade the placeholder away)",
    Boolean(authRow));

  console.log("\n== deleting twice is harmless ==");
  const { error: twice } = await users.a.db.rpc("delete_my_account");
  check("a second call does not error", !twice, twice?.message);
  check("and does not re-scrub or change deleted_at",
    (await one(`select deleted_at from profiles where id=$1`, [users.a.id])).deleted_at
      .toISOString() === profile.deleted_at.toISOString());

  console.log("\n== retention ==");
  // Seed rows old enough to be pruned, and rows that must survive.
  await sql.query(
    `insert into profile_change_events (profile_id, version, changed_fields, is_major, created_at, processed_at)
     values ($1, 999, array['name'], true, now() - interval '200 days', now() - interval '200 days')`,
    [users.b.id]);
  await sql.query(
    `insert into profile_change_events (profile_id, version, changed_fields, is_major, created_at, processed_at)
     values ($1, 998, array['bio'], false, now() - interval '200 days', null)`,
    [users.b.id]);
  await sql.query(
    `insert into rate_events (actor_id, action, created_at)
     values ($1, 'scan', now() - interval '3 days')`, [users.b.id]);

  const { rows: retention } = await sql.query(`select run_retention(5000) as r`);
  const r = retention[0].r;
  check("retention pruned the old PROCESSED change event", r.change_events >= 1, JSON.stringify(r));
  check("retention pruned stale rate_events", r.rate_events >= 1);
  check("an UNPROCESSED event is never pruned, however old — it is the worker's backlog",
    (await one(
      `select count(*)::int n from profile_change_events
        where profile_id=$1 and processed_at is null`, [users.b.id])).n === 1);

  console.log("\n== function exposure ==");
  for (const [sig, role, expected] of [
    ["delete_my_account()", "anon", false],
    ["delete_my_account()", "authenticated", true],
    ["run_retention(int)", "anon", false],
    ["run_retention(int)", "authenticated", false],
    ["run_retention(int)", "service_role", true],
  ]) {
    const { rows } = await sql.query(
      `select has_function_privilege($1, $2, 'EXECUTE') ok`, [role, `public.${sig}`]);
    check(`${role} ${expected ? "CAN" : "cannot"} execute ${sig}`, rows[0].ok === expected);
  }
} finally {
  console.log("\n== cleanup ==");
  for (const key of Object.keys(users)) {
    await admin.auth.admin.deleteUser(users[key].id).catch(() => {});
  }
  console.log(`  removed ${Object.keys(users).length} test users`);
  await sql.end();
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
process.exitCode = failures > 0 ? 1 : 0;
