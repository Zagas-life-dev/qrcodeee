import { createClient } from "@supabase/supabase-js";

import { connect } from "./db.mjs";

/**
 * §5.4 fan-out worker verification.
 *
 * Every rule here fails silently if broken: a swapped a/b slot notifies the
 * wrong person, a blind watermark assignment re-notifies everyone, and
 * advancing the watermark on a below-threshold minor change means the user
 * never hears about a slow drip of edits at all.
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
  const email = `qrwork+${key}${stamp}@example.com`;
  const password = `Test-${stamp}-${key}!aA1`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: `Work ${key.toUpperCase()}` },
  });
  if (error) throw new Error(`createUser(${key}): ${error.message}`);
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: session } = await anon.auth.signInWithPassword({ email, password });
  return {
    id: data.user.id,
    db: createClient(URL, ANON, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
    }),
  };
}

/** Drives process_change_batch to completion, like the route handler does. */
async function runWorker(profileId) {
  let cursor = null;
  let batchVersion = null;
  let totalNotified = 0;
  for (let i = 0; i < 20; i += 1) {
    const { rows } = await sql.query(
      `select process_change_batch($1, $2, $3) as r`,
      [profileId, cursor, batchVersion],
    );
    const r = rows[0].r;
    if (!r.locked) return { locked: false, notified: totalNotified };
    totalNotified += r.notified ?? 0;
    if (r.done) return { locked: true, notified: totalNotified, version: r.version };
    cursor = r.cursor;
    batchVersion = r.batch_version;
  }
  throw new Error("worker did not finish");
}

const versionOf = async (id) =>
  (await sql.query(`select profile_version from profiles where id=$1`, [id])).rows[0].profile_version;
const conn = async (a, b) =>
  (await sql.query(
    `select * from connections where least(user_a,user_b)=least($1::uuid,$2::uuid)
       and greatest(user_a,user_b)=greatest($1::uuid,$2::uuid)`, [a, b])).rows[0];
const notifs = async (recipient, source, type) =>
  (await sql.query(
    `select * from notifications where recipient_id=$1 and source_profile_id=$2
       ${type ? "and type=$3" : ""} order by dedupe_seq`,
    type ? [recipient, source, type] : [recipient, source])).rows;
const pendingEvents = async (id) =>
  (await sql.query(
    `select count(*)::int n from profile_change_events where profile_id=$1 and processed_at is null`,
    [id])).rows[0].n;

try {
  users.a = await makeUser("a");
  users.b = await makeUser("b");

  // A scans B, so A is user_a and B is user_b — the slot mapping matters below.
  await users.a.db.rpc("connect_via_scan", {
    scanned_token: (await sql.query(`select qr_token from profiles where id=$1`, [users.b.id])).rows[0].qr_token,
  });
  await runWorker(users.a.id);
  await runWorker(users.b.id);

  console.log("\n== major change fans out immediately ==");
  await users.a.db.from("profiles").update({ name: "Work A Renamed" }).eq("id", users.a.id);
  const aVersion = await versionOf(users.a.id);
  check("a change event is waiting", (await pendingEvents(users.a.id)) === 1);

  const run1 = await runWorker(users.a.id);
  check("worker acquired the lock", run1.locked);
  const majorNotifs = await notifs(users.b.id, users.a.id, "major_change");
  check("recipient is B, not A — the source never notifies itself", majorNotifs.length === 1);
  check("change_version is the batch version", majorNotifs[0]?.change_version === aVersion);
  check("dedupe_seq is the version (not an epoch)", majorNotifs[0]?.dedupe_seq === aVersion);
  check("events were marked processed", (await pendingEvents(users.a.id)) === 0);

  // Source is user_a, so the column that must move is b_notified_version — it
  // tracks how current B is on A's profile. Advancing a_notified_version instead
  // is the classic inversion and nothing else would catch it.
  const c1 = await conn(users.a.id, users.b.id);
  check("A is in slot user_a for this test", c1.user_a === users.a.id);
  check("b_notified_version advanced to A's version", c1.b_notified_version === aVersion,
    `b_notified=${c1.b_notified_version}, A is v${aVersion}`);
  check("a_notified_version was NOT touched (that tracks B's profile)",
    c1.a_notified_version === (await versionOf(users.b.id)),
    `a_notified=${c1.a_notified_version}, B is v${await versionOf(users.b.id)}`);

  console.log("\n== idempotency ==");
  await runWorker(users.a.id);
  await runWorker(users.a.id);
  check("re-running produces no duplicate notifications",
    (await notifs(users.b.id, users.a.id, "major_change")).length === 1);

  console.log("\n== the other slot direction ==");
  await users.b.db.from("profiles").update({ name: "Work B Renamed" }).eq("id", users.b.id);
  const bVersion = await versionOf(users.b.id);
  await runWorker(users.b.id);
  check("A is notified about B", (await notifs(users.a.id, users.b.id, "major_change")).length === 1);
  const c2 = await conn(users.a.id, users.b.id);
  check("this time a_notified_version advanced", c2.a_notified_version === bVersion,
    `a_notified=${c2.a_notified_version}, B is v${bVersion}`);
  check("and b_notified_version stayed put", c2.b_notified_version === aVersion);

  console.log("\n== minor changes accumulate to a threshold ==");
  const before = (await notifs(users.b.id, users.a.id)).length;
  const watermarkBefore = (await conn(users.a.id, users.b.id)).b_notified_version;

  // Edit 1: gap of 1, below the threshold of 3.
  await users.a.db.from("profiles").update({ bio: "bio one" }).eq("id", users.a.id);
  await runWorker(users.a.id);
  check("one minor change does not notify",
    (await notifs(users.b.id, users.a.id)).length === before);
  // The load-bearing part: leaving the watermark alone is what lets the gap keep
  // growing. Advancing it here would reset the count on every edit and the
  // threshold would never be reached.
  check("and the watermark is left ALONE so the gap keeps accumulating",
    (await conn(users.a.id, users.b.id)).b_notified_version === watermarkBefore);

  // Edit 2: gap of 2, still below.
  await users.a.db.from("profiles").update({ bio: "bio two" }).eq("id", users.a.id);
  await runWorker(users.a.id);
  check("two minor changes still do not notify",
    (await notifs(users.b.id, users.a.id)).length === before);

  // Edit 3: gap of 3, threshold reached.
  await users.a.db.from("profiles").update({ bio: "bio three" }).eq("id", users.a.id);
  await runWorker(users.a.id);
  const accum = await notifs(users.b.id, users.a.id, "accumulated_changes");
  check("the third minor change crosses the threshold", accum.length === 1,
    `got ${accum.length}`);
  check("it is accumulated_changes, not major_change",
    accum[0]?.type === "accumulated_changes");
  check("now the watermark advances",
    (await conn(users.a.id, users.b.id)).b_notified_version === (await versionOf(users.a.id)));

  console.log("\n== watermarks never move backwards ==");
  const current = (await conn(users.a.id, users.b.id)).b_notified_version;
  await sql.query(`update connections set b_notified_version = $1 where id = $2`,
    [current + 50, (await conn(users.a.id, users.b.id)).id]);
  await users.a.db.from("profiles").update({ name: "Work A Again" }).eq("id", users.a.id);
  await runWorker(users.a.id);
  check("greatest() prevents a stale batch walking the watermark back",
    (await conn(users.a.id, users.b.id)).b_notified_version === current + 50,
    `watermark is now ${(await conn(users.a.id, users.b.id)).b_notified_version}, was ${current + 50}`);
  await sql.query(`update connections set b_notified_version = $1 where id = $2`,
    [current, (await conn(users.a.id, users.b.id)).id]);

  console.log("\n== advisory lock ==");
  // Hold the lock in one transaction while another run tries to take it.
  await sql.query("begin");
  await sql.query(`select pg_try_advisory_xact_lock(hashtext($1::text))`, [users.a.id]);
  const other = await connect();
  const { rows: blockedRun } = await other.query(
    `select process_change_batch($1) as r`, [users.a.id]);
  check("a second overlapping run backs off instead of double-fanning",
    blockedRun[0].r.locked === false, JSON.stringify(blockedRun[0].r));
  await other.end();
  await sql.query("rollback");

  console.log("\n== connections excluded from fan-out ==");
  const cRow = await conn(users.a.id, users.b.id);
  await sql.query(`update connections set disconnected_at = now() where id = $1`, [cRow.id]);
  const notifsBeforeDisconnect = (await notifs(users.b.id, users.a.id)).length;
  await users.a.db.from("profiles").update({ name: "Changed While Disconnected" }).eq("id", users.a.id);
  await runWorker(users.a.id);
  check("a disconnected connection receives nothing",
    (await notifs(users.b.id, users.a.id)).length === notifsBeforeDisconnect);
  await sql.query(`update connections set disconnected_at = null where id = $1`, [cRow.id]);

  await users.a.db.from("blocks").insert({ blocker_id: users.a.id, blocked_id: users.b.id });
  const notifsBeforeBlock = (await notifs(users.b.id, users.a.id)).length;
  await users.a.db.from("profiles").update({ name: "Changed While Blocked" }).eq("id", users.a.id);
  await runWorker(users.a.id);
  check("a blocked pair receives nothing",
    (await notifs(users.b.id, users.a.id)).length === notifsBeforeBlock);
  await sql.query(`delete from blocks where blocker_id = $1`, [users.a.id]);

  console.log("\n== worker RPCs are not client-reachable ==");
  for (const sig of ["process_change_batch(uuid,uuid,int,int,int)", "pending_change_profiles(int)"]) {
    for (const role of ["anon", "authenticated"]) {
      const { rows } = await sql.query(
        `select has_function_privilege($1, $2, 'EXECUTE') ok`, [role, `public.${sig}`]);
      check(`${role} cannot execute ${sig.split("(")[0]}`, rows[0].ok === false);
    }
  }
  const { rows: svc } = await sql.query(
    `select has_function_privilege('service_role', 'public.process_change_batch(uuid,uuid,int,int,int)', 'EXECUTE') ok`);
  check("service_role CAN execute the worker", svc[0].ok === true);
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
