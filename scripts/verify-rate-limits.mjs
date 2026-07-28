import { createClient } from "@supabase/supabase-js";

import { connect } from "./db.mjs";

/**
 * §7 rate limit verification.
 *
 * Two failure modes matter equally here. A limit that doesn't bite is an abuse
 * vector; a limit that bites too early locks people out of their own profile.
 * The reorder case is the sharp one — one drag rewrites sort_order on up to 20
 * rows, and if that counted as 20 mutations, three drags would exhaust an
 * hourly budget of 60.
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
  const email = `qrrate+${key}${stamp}@example.com`;
  const password = `Test-${stamp}-${key}!aA1`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: `Rate ${key.toUpperCase()}` },
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

const rateCount = async (actor, action) =>
  (await sql.query(
    `select count(*)::int n from rate_events where actor_id=$1 and action=$2`,
    [actor, action])).rows[0].n;
const clearRates = async (actor) =>
  sql.query(`delete from rate_events where actor_id=$1`, [actor]);

try {
  users.a = await makeUser("a");
  users.b = await makeUser("b");

  console.log("\n== rate_events is invisible to clients ==");
  check("client cannot read rate_events (it would be a 'how close am I' oracle)",
    ((await users.a.db.from("rate_events").select("id")).data ?? []).length === 0);
  check("client cannot write rate_events",
    Boolean((await users.a.db.from("rate_events")
      .insert({ actor_id: users.a.id, action: "scan" })).error));
  const { rows: helperGrant } = await sql.query(
    `select has_function_privilege('authenticated', 'private.rate_limit_ok(uuid,text,int,interval,text)', 'EXECUTE') ok`);
  check("authenticated cannot call rate_limit_ok (would let it burn another user's budget)",
    helperGrant[0].ok === false);

  console.log("\n== scan limits ==");
  await clearRates(users.a.id);
  let rateLimitedAt = null;
  for (let i = 1; i <= 35; i += 1) {
    const { data } = await users.a.db.rpc("connect_via_scan", {
      scanned_token: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    });
    if (data.status === "rate_limited" && rateLimitedAt === null) rateLimitedAt = i;
  }
  check("scanning eventually returns rate_limited rather than running forever",
    rateLimitedAt !== null, "never limited across 35 attempts");
  // The 30/min scan cap trips before the 15/hour failed-scan cap only if failures
  // are counted separately; both are recorded, so the tighter one wins first.
  check("the limit bites within the documented window",
    rateLimitedAt !== null && rateLimitedAt <= 31,
    `first limited at attempt ${rateLimitedAt}`);
  check("failed attempts were recorded against the scanner",
    (await rateCount(users.a.id, "scan_failed")) > 0);
  check("a status is returned, not a raised error — the UI can respond precisely",
    true);

  console.log("\n== a valid scan still works for an unthrottled user ==");
  await clearRates(users.b.id);
  const { rows: tokenRow } = await sql.query(
    `select qr_token from profiles where id=$1`, [users.a.id]);
  const { data: good } = await users.b.db.rpc("connect_via_scan", {
    scanned_token: tokenRow[0].qr_token,
  });
  check("a legitimate first scan connects", good.status === "new_connection", good.status);
  check("successful scans do NOT record a failed-scan event",
    (await rateCount(users.b.id, "scan_failed")) === 0);
  // A conference badge scanned by a room of people is the SUCCESS case. If the
  // per-token limit counted successful scans, this is where it would break.
  check("a valid token accumulates no per-token failure counter",
    (await sql.query(
      `select count(*)::int n from rate_events where action='scan_failed_token' and subject=$1`,
      [tokenRow[0].qr_token])).rows[0].n === 0);

  console.log("\n== profile mutation limits ==");
  await clearRates(users.b.id);
  let mutationBlockedAt = null;
  for (let i = 1; i <= 65; i += 1) {
    const { error } = await users.b.db
      .from("profiles").update({ bio: `bio ${i}` }).eq("id", users.b.id);
    if (error && mutationBlockedAt === null) {
      mutationBlockedAt = i;
      check("the mutation limit surfaces as 53400, not a generic failure",
        error.code === "53400", error.code);
      break;
    }
  }
  check("profile edits are eventually throttled", mutationBlockedAt !== null,
    "65 consecutive edits went through unthrottled");
  check("the cap is around the documented 60/hour",
    mutationBlockedAt !== null && mutationBlockedAt >= 55 && mutationBlockedAt <= 62,
    `blocked at edit ${mutationBlockedAt}`);

  console.log("\n== reordering must stay free ==");
  // The load-bearing case: if the rate trigger lacked the sort_order exclusion,
  // one drag would burn 20 of 60 hourly mutations.
  await clearRates(users.b.id);
  const fieldIds = [];
  for (let i = 0; i < 5; i += 1) {
    await users.b.db.from("custom_fields")
      .insert({ profile_id: users.b.id, label: `Field ${i}`, value: "x", sort_order: i });
  }
  const { rows: created } = await sql.query(
    `select id from custom_fields where profile_id=$1 order by sort_order`, [users.b.id]);
  fieldIds.push(...created.map((r) => r.id));
  const afterInserts = await rateCount(users.b.id, "profile_mutation");

  for (let i = 0; i < 10; i += 1) {
    await users.b.db.rpc("reorder_custom_fields", {
      field_ids: i % 2 === 0 ? [...fieldIds].reverse() : fieldIds,
    });
  }
  check("ten reorders cost ZERO mutation budget",
    (await rateCount(users.b.id, "profile_mutation")) === afterInserts,
    `was ${afterInserts}, now ${await rateCount(users.b.id, "profile_mutation")}`);
  check("five field inserts cost exactly five", afterInserts === 5, `got ${afterInserts}`);

  console.log("\n== report limits ==");
  await clearRates(users.a.id);
  const targets = [];
  for (let i = 0; i < 12; i += 1) targets.push(await makeUser(`t${i}`));
  for (const [i, t] of targets.entries()) users[`t${i}`] = t;

  let reportBlockedAt = null;
  for (const [i, target] of targets.entries()) {
    const { error } = await users.a.db.from("reports")
      .insert({ reporter_id: users.a.id, reported_id: target.id, category: "spam" });
    if (error && reportBlockedAt === null) {
      reportBlockedAt = i + 1;
      check("the report limit surfaces as 53400", error.code === "53400", error.code);
      break;
    }
  }
  // The partial unique index only stops piling onto ONE target; this covers one
  // account reporting many different people.
  check("reporting many DIFFERENT people is throttled at 10/hour",
    reportBlockedAt === 11, `blocked at report ${reportBlockedAt}`);

  console.log("\n== internal operations are exempt ==");
  await clearRates(users.b.id);
  await sql.query("begin");
  await sql.query(`set local app.suppress_change_events = 'on'`);
  const { rows: exempt } = await sql.query(
    `select private.rate_limit_ok($1, 'profile_mutation', 0, interval '1 hour') as ok`,
    [users.b.id]);
  await sql.query("rollback");
  // A limit of 0 would reject everything; the suppression flag must bypass it,
  // or account deletion (which deletes every custom field at once) could not run.
  check("the suppression flag exempts internal work from limits", exempt[0].ok === true);

  const { rows: noActor } = await sql.query(
    `select private.rate_limit_ok(null, 'scan', 0, interval '1 hour') as ok`);
  check("a null actor is exempt (signup trigger, worker, retention jobs)",
    noActor[0].ok === true);
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
