import { createClient } from "@supabase/supabase-js";

import { connect } from "./db.mjs";

/**
 * §5.6 disconnect / block / report verification.
 *
 * The load-bearing case is the membership check inside disconnect_connection:
 * it runs SECURITY DEFINER, so RLS is not filtering that UPDATE and the only
 * thing stopping a stranger severing two other people's connection is a
 * predicate in the function body.
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
  const email = `qrmod+${key}${stamp}@example.com`;
  const password = `Test-${stamp}-${key}!aA1`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: `Mod ${key.toUpperCase()}` },
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

const tokenOf = async (id) =>
  (await sql.query(`select qr_token from profiles where id=$1`, [id])).rows[0].qr_token;
const connRow = async (a, b) =>
  (await sql.query(
    `select * from connections where least(user_a,user_b)=least($1::uuid,$2::uuid)
       and greatest(user_a,user_b)=greatest($1::uuid,$2::uuid)`, [a, b])).rows[0];

try {
  users.a = await makeUser("a");
  users.b = await makeUser("b");
  users.c = await makeUser("c");

  await users.a.db.rpc("connect_via_scan", { scanned_token: await tokenOf(users.b.id) });
  await sql.query(
    `update contact_details set phone='+15551110000' where profile_id=$1`, [users.b.id]);
  const row = await connRow(users.a.id, users.b.id);

  console.log("\n== disconnect: membership is the only guard ==");
  // C is not on this connection. DEFINER means RLS isn't filtering the UPDATE,
  // so if the predicate in the function body were missing, this would succeed.
  const { data: strangerResult } = await users.c.db.rpc("disconnect_connection", {
    p_connection_id: row.id,
  });
  check("a non-party cannot disconnect someone else's connection",
    strangerResult === false, `returned ${strangerResult}`);
  check("and the connection is untouched",
    (await connRow(users.a.id, users.b.id)).disconnected_at === null);

  const { data: bogus } = await users.a.db.rpc("disconnect_connection", {
    p_connection_id: "00000000-0000-4000-8000-000000000000",
  });
  check("a nonexistent id returns false rather than erroring", bogus === false);

  console.log("\n== disconnect: the real path ==");
  const { data: ok } = await users.a.db.rpc("disconnect_connection", {
    p_connection_id: row.id,
  });
  check("a party can disconnect", ok === true);
  const afterDisconnect = await connRow(users.a.id, users.b.id);
  check("it is a SOFT delete — the row survives as the audit trail",
    afterDisconnect !== undefined && afterDisconnect.disconnected_at !== null);
  check("connected_at is preserved", afterDisconnect.connected_at !== null);

  check("neither side can see the connection any more",
    ((await users.a.db.from("connections").select("id")).data ?? []).length === 0 &&
    ((await users.b.db.from("connections").select("id")).data ?? []).length === 0);
  check("contact details are gated again once disconnected",
    ((await users.a.db.from("contact_details").select("phone").eq("profile_id", users.b.id)).data ?? []).length === 0);

  const { data: again } = await users.a.db.rpc("disconnect_connection", {
    p_connection_id: row.id,
  });
  check("disconnecting twice returns false, not an error", again === false);

  console.log("\n== reconnect after disconnect ==");
  const rescan = await users.a.db.rpc("connect_via_scan", {
    scanned_token: await tokenOf(users.b.id),
  });
  check("scanning again reconnects", rescan.data?.status === "new_connection",
    rescan.data?.status);
  check("it reactivated the SAME row", (await connRow(users.a.id, users.b.id)).id === row.id);
  check("contact details are readable again",
    ((await users.a.db.from("contact_details").select("phone").eq("profile_id", users.b.id)).data ?? []).length === 1);

  console.log("\n== block list stays readable to the blocker ==");
  await users.a.db.from("blocks").insert({ blocker_id: users.a.id, blocked_id: users.b.id });

  // The reason list_blocked exists: the profiles policy checks is_blocked in
  // BOTH directions, so A can no longer read B's profile through a normal query.
  check("a plain profile read of the blocked person returns nothing",
    ((await users.a.db.from("profiles").select("name").eq("id", users.b.id)).data ?? []).length === 0);

  const { data: blockedList, error: listError } = await users.a.db.rpc("list_blocked");
  check("list_blocked works", !listError, listError?.message);
  check("it returns the blocked person", (blockedList ?? []).length === 1);
  check("WITH their name — otherwise unblocking is impossible to do meaningfully",
    Boolean(blockedList?.[0]?.name) && blockedList[0].name.startsWith("Mod B"),
    JSON.stringify(blockedList?.[0]));
  check("it is scoped to the caller — C sees an empty list",
    ((await users.c.db.rpc("list_blocked")).data ?? []).length === 0);

  console.log("\n== unblock restores ==");
  await users.a.db.from("blocks").delete().eq("blocker_id", users.a.id).eq("blocked_id", users.b.id);
  check("the connection comes back after unblocking",
    ((await users.a.db.from("connections").select("id")).data ?? []).length === 1);
  check("block list is empty again", ((await users.a.db.rpc("list_blocked")).data ?? []).length === 0);

  console.log("\n== blocking constraints ==");
  await users.a.db.from("blocks").insert({ blocker_id: users.a.id, blocked_id: users.c.id });
  const dup = await users.a.db.from("blocks").insert({ blocker_id: users.a.id, blocked_id: users.c.id });
  check("blocking twice is a unique violation, not a duplicate row", dup.error?.code === "23505");
  const self = await users.a.db.from("blocks").insert({ blocker_id: users.a.id, blocked_id: users.a.id });
  check("cannot block yourself", self.error?.code === "23514", self.error?.code);
  const forged = await users.a.db.from("blocks").insert({ blocker_id: users.c.id, blocked_id: users.b.id });
  check("cannot create a block on someone else's behalf", Boolean(forged.error));
  await sql.query(`delete from blocks where blocker_id = $1`, [users.a.id]);

  console.log("\n== reports ==");
  const report = await users.a.db.from("reports")
    .insert({ reporter_id: users.a.id, reported_id: users.b.id, category: "spam", notes: "test" });
  check("a report can be filed", !report.error, report.error?.message);

  const second = await users.a.db.from("reports")
    .insert({ reporter_id: users.a.id, reported_id: users.b.id, category: "harassment" });
  check("cannot pile a second OPEN report on the same person", second.error?.code === "23505");

  const badCategory = await users.a.db.from("reports")
    .insert({ reporter_id: users.a.id, reported_id: users.c.id, category: "not-a-category" });
  check("category is constrained to the allowed set", badCategory.error?.code === "23514");

  const selfReport = await users.a.db.from("reports")
    .insert({ reporter_id: users.a.id, reported_id: users.a.id, category: "spam" });
  check("cannot report yourself", selfReport.error?.code === "23514");

  const forgedReport = await users.a.db.from("reports")
    .insert({ reporter_id: users.c.id, reported_id: users.b.id, category: "spam" });
  check("cannot file a report as someone else", Boolean(forgedReport.error));

  check("the reporter can see their own report",
    ((await users.a.db.from("reports").select("id")).data ?? []).length === 1);
  check("the REPORTED person cannot see it",
    ((await users.b.db.from("reports").select("id")).data ?? []).length === 0);
  check("an unrelated user cannot see it",
    ((await users.c.db.from("reports").select("id")).data ?? []).length === 0);

  // resolved_at is moderation-only. No UPDATE policy exists on reports, so a
  // reporter cannot close their own case to unlock filing another.
  const closeIt = await users.a.db.from("reports")
    .update({ resolved_at: new Date().toISOString() }).eq("reporter_id", users.a.id);
  const { rows: stillOpen } = await sql.query(
    `select resolved_at from reports where reporter_id=$1`, [users.a.id]);
  check("a reporter cannot resolve their own report",
    stillOpen[0]?.resolved_at === null, `error: ${closeIt.error?.code ?? "none"}`);

  // After moderation closes the case, a genuine new report must be possible —
  // that is the whole point of the PARTIAL unique index over a flat one.
  await sql.query(`update reports set resolved_at = now() where reporter_id=$1`, [users.a.id]);
  const later = await users.a.db.from("reports")
    .insert({ reporter_id: users.a.id, reported_id: users.b.id, category: "harassment" });
  check("a new report IS allowed once the previous one is resolved",
    !later.error, later.error?.message);

  console.log("\n== connection search ==");
  // A and B are connected again at this point (reconnected above).
  const search = async (user, q) =>
    (await user.db.rpc("search_connections", { p_query: q ?? null, p_limit: 25, p_offset: 0 })).data ?? [];

  check("an empty query returns the caller's connections",
    (await search(users.a)).length === 1);
  check("a matching name is found", (await search(users.a, "Mod B")).length === 1);
  check("a non-matching name returns nothing", (await search(users.a, "zzzz")).length === 0);
  check("search is case-insensitive", (await search(users.a, "mod b")).length === 1);
  check("total_count accompanies the page", Number((await search(users.a))[0]?.total_count) === 1);

  // SECURITY INVOKER is the whole design — RLS scopes this, not the function.
  // A DEFINER version with a wrong predicate would silently become
  // "search everyone's connections".
  check("C cannot see A and B's connection through search",
    (await search(users.c, "Mod")).length === 0);

  // % and _ are ILIKE wildcards; unescaped, a search for "%" matches everyone.
  check("ILIKE wildcards in the query are escaped, not honoured",
    (await search(users.a, "%")).length === 0);
  check("underscore is escaped too", (await search(users.a, "_")).length === 0);

  await sql.query(`update connections set disconnected_at = now() where id = $1`, [row.id]);
  check("a disconnected connection disappears from search",
    (await search(users.a)).length === 0);
  await sql.query(`update connections set disconnected_at = null where id = $1`, [row.id]);

  console.log("\n== function exposure ==");
  for (const sig of ["disconnect_connection(uuid)", "list_blocked()"]) {
    const { rows } = await sql.query(
      `select has_function_privilege('anon', $1, 'EXECUTE') ok`, [`public.${sig}`]);
    check(`anon holds no EXECUTE grant on ${sig}`, rows[0].ok === false);
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
