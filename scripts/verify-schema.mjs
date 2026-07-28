import { readFile } from "node:fs/promises";
import path from "node:path";

import { connect } from "./db.mjs";

/**
 * Structural verification. Everything checked here is something that compiles
 * fine, deploys fine, and is wrong — the class of bug this schema is full of.
 */

let failures = 0;
let checks = 0;

function check(label, ok, detail) {
  checks += 1;
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ""}`);
  }
}

const TABLES = [
  "profiles", "contact_details", "custom_fields", "connections",
  "blocks", "reports", "profile_change_events", "notifications",
  "push_subscriptions", "contact_saves", "rate_events",
];

const client = await connect();

try {
  console.log("\n== tables and RLS ==");
  const { rows: tables } = await client.query(
    `select relname, relrowsecurity, relforcerowsecurity
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and relname = any($1)`,
    [TABLES],
  );
  check(`all ${TABLES.length} tables exist`, tables.length === TABLES.length,
    `found: ${tables.map((t) => t.relname).sort().join(", ")}`);
  for (const t of tables) {
    check(`RLS enabled on ${t.relname}`, t.relrowsecurity);
  }

  console.log("\n== policies ==");
  const { rows: policies } = await client.query(
    `select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by tablename, policyname`,
  );
  const byTable = {};
  for (const p of policies) (byTable[p.tablename] ??= []).push(p);

  check("profiles has exactly 2 policies (select + update)", byTable.profiles?.length === 2);
  check("contact_details has 2 policies (owner ALL + connections SELECT)", byTable.contact_details?.length === 2);
  check("custom_fields has 2 policies", byTable.custom_fields?.length === 2);
  check("connections has exactly 1 policy (SELECT only — no client writes)",
    byTable.connections?.length === 1 && byTable.connections[0].cmd === "SELECT");
  check("profile_change_events has ZERO policies (RLS on, no access)",
    (byTable.profile_change_events ?? []).length === 0);
  check("rate_events has ZERO policies (reading it would be a limit oracle)",
    (byTable.rate_events ?? []).length === 0);
  check("notifications has 2 policies (select + update, no insert)",
    byTable.notifications?.length === 2 &&
    !byTable.notifications.some((p) => p.cmd === "INSERT"));
  check("push_subscriptions is owner-only (1 ALL policy)",
    byTable.push_subscriptions?.length === 1 &&
    byTable.push_subscriptions[0].cmd === "ALL");
  // The SUBJECT must not be able to read these — "who downloaded my card and
  // when" is a surveillance signal nobody consented to at scan time.
  const { rows: savePolicy } = await client.query(
    `select qual from pg_policies where schemaname='public' and tablename='contact_saves'`,
  );
  check("contact_saves is scoped to the downloader only",
    savePolicy.length === 1 && /owner_id = auth\.uid\(\)/.test(savePolicy[0].qual ?? ""),
    savePolicy[0]?.qual);
  check("contact_saves policy does not expose subject_id to the subject",
    !/subject_id = auth\.uid\(\)/.test(savePolicy[0]?.qual ?? ""));

  // The block check must go through private.is_blocked, never an inline
  // subquery on `blocks` — an inline one is invisible to the blocked party's
  // own policy evaluation and silently makes blocking one-directional.
  console.log("\n== policies use the SECURITY DEFINER helpers, not inline subqueries ==");
  const { rows: defs } = await client.query(
    `select tablename, policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
       from pg_policies where schemaname = 'public'`,
  );
  for (const d of defs) {
    if (/\bblocks\b/.test(d.expr) && !/private\.is_blocked/.test(d.expr)) {
      check(`${d.tablename}."${d.policyname}" does not inline a blocks subquery`, false,
        `expr: ${d.expr.slice(0, 160)}`);
    }
  }
  check("no policy inlines a `blocks` subquery",
    !defs.some((d) => /\bblocks\b/.test(d.expr) && !/private\.is_blocked/.test(d.expr)));
  check("connections policy checks blocks",
    defs.some((d) => d.tablename === "connections" && /private\.is_blocked/.test(d.expr)));
  check("contact_details connection policy uses has_active_connection",
    defs.some((d) => d.tablename === "contact_details" && /private\.has_active_connection/.test(d.expr)));
  check("profiles SELECT policy does NOT filter deleted_at (§8 placeholder)",
    !defs.some((d) => d.tablename === "profiles" && /deleted_at/.test(d.expr)));

  console.log("\n== column-level UPDATE grants ==");
  const { rows: grants } = await client.query(
    `select table_name, column_name, grantee
       from information_schema.column_privileges
      where table_schema = 'public' and privilege_type = 'UPDATE'
        and grantee in ('authenticated','anon')
      order by table_name, grantee, column_name`,
  );
  const cols = (t, g) => grants.filter((r) => r.table_name === t && r.grantee === g)
    .map((r) => r.column_name).sort();

  const profileCols = cols("profiles", "authenticated");
  check("authenticated can UPDATE exactly name/photo_url/bio/qr_style on profiles",
    JSON.stringify(profileCols) === JSON.stringify(["bio", "name", "photo_url", "qr_style"]),
    `got: ${profileCols.join(", ") || "(none)"}`);
  check("authenticated CANNOT update profiles.profile_version", !profileCols.includes("profile_version"));
  check("profiles.qr_token no longer exists (§6: no permanent codes)",
    !profileCols.includes("qr_token"));
  check("authenticated has no column grants at all on qr_tokens",
    cols("qr_tokens", "authenticated").length === 0);
  check("anon has no column grants at all on qr_tokens",
    cols("qr_tokens", "anon").length === 0);
  check("authenticated CANNOT update profiles.deleted_at", !profileCols.includes("deleted_at"));
  check("anon has no UPDATE on profiles", cols("profiles", "anon").length === 0);

  const notifCols = cols("notifications", "authenticated");
  check("authenticated can UPDATE only read_at on notifications",
    JSON.stringify(notifCols) === JSON.stringify(["read_at"]),
    `got: ${notifCols.join(", ") || "(none)"}`);

  console.log("\n== private schema ==");
  const { rows: fns } = await client.query(
    `select p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as owner
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' order by proname`,
  );
  for (const name of ["is_blocked", "has_active_connection", "has_blocked", "change_events_suppressed"]) {
    const fn = fns.find((f) => f.proname === name);
    check(`private.${name} exists`, Boolean(fn));
    if (fn && name !== "change_events_suppressed") {
      check(`private.${name} is SECURITY DEFINER`, fn.prosecdef);
      check(`private.${name} has search_path pinned`,
        (fn.proconfig ?? []).some((c) => c.startsWith("search_path=")));
    }
  }

  const { rows: schemaGrants } = await client.query(
    `select r.rolname, has_schema_privilege(r.rolname, 'private', 'USAGE') as usage
       from pg_roles r where r.rolname in ('anon','authenticated','service_role')`,
  );
  for (const g of schemaGrants) {
    check(`${g.rolname} has USAGE on schema private`, g.usage);
  }
  check("anon can EXECUTE private.is_blocked (needed for logged-out profile reads)",
    (await client.query(`select has_function_privilege('anon', 'private.is_blocked(uuid,uuid)', 'EXECUTE') ok`)).rows[0].ok);
  check("service_role can EXECUTE private.is_blocked (needed by the §5.4 worker)",
    (await client.query(`select has_function_privilege('service_role', 'private.is_blocked(uuid,uuid)', 'EXECUTE') ok`)).rows[0].ok);
  check("anon CANNOT execute private.has_active_connection (social-graph oracle)",
    !(await client.query(`select has_function_privilege('anon', 'private.has_active_connection(uuid,uuid)', 'EXECUTE') ok`)).rows[0].ok);
  check("anon CANNOT execute private.has_blocked",
    !(await client.query(`select has_function_privilege('anon', 'private.has_blocked(uuid,uuid)', 'EXECUTE') ok`)).rows[0].ok);
  check("authenticated CANNOT execute private.has_blocked",
    !(await client.query(`select has_function_privilege('authenticated', 'private.has_blocked(uuid,uuid)', 'EXECUTE') ok`)).rows[0].ok);

  console.log("\n== trigger functions (SECURITY DEFINER is load-bearing) ==");
  const { rows: trigFns } = await client.query(
    `select p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as owner
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any($1)`,
    [["log_profile_change_event", "log_contact_details_change_event",
      "log_custom_field_change_event", "enforce_custom_field_limit", "handle_new_user"]],
  );
  for (const fn of trigFns) {
    check(`${fn.proname} is SECURITY DEFINER`, fn.prosecdef);
    check(`${fn.proname} owned by a superuser (bypasses RLS)`, fn.owner === "postgres" || fn.owner === "supabase_admin",
      `owner: ${fn.owner}`);
    check(`${fn.proname} has search_path pinned`,
      (fn.proconfig ?? []).some((c) => c.startsWith("search_path=")));
  }
  check("all 5 SECURITY DEFINER trigger functions present", trigFns.length === 5,
    `found ${trigFns.length}: ${trigFns.map((f) => f.proname).join(", ")}`);

  // Supabase's default privileges explicitly grant EXECUTE on public functions
  // to anon/authenticated, and `revoke ... from public` does NOT remove them.
  // So every new function is anon-callable as POST /rpc/<name> until revoked.
  console.log("\n== no anon-callable RPCs in public ==");
  const { rows: publicFns } = await client.query(
    `select p.oid::regprocedure::text as sig, p.proname, p.prosecdef,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prokind = 'f'
        -- event_trigger-returning functions can't be exposed over HTTP by
        -- PostgREST at all. The one that exists is Supabase's own
        -- rls_auto_enable(), which is platform-managed and not ours to revoke.
        and p.prorettype <> 'pg_catalog.event_trigger'::regtype
        and not exists (
          select 1 from pg_depend d
           where d.objid = p.oid and d.deptype = 'e'  -- skip extension-owned
        )`,
  );
  const anonCallable = publicFns.filter((f) => f.anon_exec);
  check("no function in public is executable by anon", anonCallable.length === 0,
    anonCallable.map((f) => f.sig).join(", "));

  // Trigger functions must not be reachable by any client role either.
  const TRIGGER_FNS = [
    "set_updated_at", "bump_profile_version", "log_profile_change_event",
    "log_contact_details_change_event", "log_custom_field_change_event",
    "enforce_custom_field_limit", "handle_new_user",
  ];
  const exposedTriggers = publicFns.filter(
    (f) => TRIGGER_FNS.includes(f.proname) && f.auth_exec,
  );
  check("trigger functions are not callable by authenticated either",
    exposedTriggers.length === 0, exposedTriggers.map((f) => f.sig).join(", "));

  // The client RPCs must still work for signed-in users.
  for (const sig of [
    "connect_via_scan(text)", "rotate_qr_token()", "mint_qr_token()",
    "reorder_custom_fields(uuid[])",
  ]) {
    const fn = publicFns.find((f) => f.sig.startsWith(sig.split("(")[0] + "("));
    check(`authenticated CAN still execute ${sig}`, fn?.auth_exec === true);
  }

  console.log("\n== triggers ==");
  const { rows: trigs } = await client.query(
    `select c.relname as tbl, t.tgname, pg_get_triggerdef(t.oid) as def
       from pg_trigger t join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal and n.nspname in ('public','auth') order by c.relname, t.tgname`,
  );
  const trig = (name) => trigs.find((t) => t.tgname === name);
  check("on_auth_user_created exists on auth.users", Boolean(trig("on_auth_user_created")));
  check("profiles_bump_version fires only on name/photo_url/bio",
    /name IS DISTINCT FROM/.test(trig("profiles_bump_version")?.def ?? "") &&
    !/qr_style/.test(trig("profiles_bump_version")?.def ?? ""));
  check("custom_fields_log_update_event ignores sort_order (free reordering)",
    !/sort_order/.test(trig("custom_fields_log_update_event")?.def ?? ""));
  check("contact_details_log_change_event fires on INSERT, UPDATE and DELETE",
    /INSERT OR DELETE OR UPDATE|INSERT OR UPDATE OR DELETE/.test(trig("contact_details_log_change_event")?.def ?? ""),
    trig("contact_details_log_change_event")?.def?.slice(0, 120));

  console.log("\n== indexes ==");
  const { rows: idx } = await client.query(
    `select indexname, indexdef from pg_indexes where schemaname = 'public'`,
  );
  const has = (name) => idx.find((i) => i.indexname === name);
  check("unique_connection_pair uses least/greatest (order-independent)",
    /least/i.test(has("unique_connection_pair")?.indexdef ?? "") &&
    /greatest/i.test(has("unique_connection_pair")?.indexdef ?? ""));
  check("notifications_idempotency keys on all 4 columns",
    /recipient_id.*source_profile_id.*type.*dedupe_seq/s.test(has("notifications_idempotency")?.indexdef ?? ""));
  check("profile_change_events_pending_idx is partial on processed_at is null",
    /WHERE \(processed_at IS NULL\)/i.test(has("profile_change_events_pending_idx")?.indexdef ?? ""));
  check("reports_one_open_per_pair is partial on resolved_at is null",
    /WHERE \(resolved_at IS NULL\)/i.test(has("reports_one_open_per_pair")?.indexdef ?? ""));
  check("notifications_unread_idx is partial on read_at is null",
    /WHERE \(read_at IS NULL\)/i.test(has("notifications_unread_idx")?.indexdef ?? ""));

  // `supabase gen types` needs Docker to run postgres-meta, so database.types.ts
  // is hand-maintained (and deliberately narrower than generated output — it
  // omits columns the §4 column grants make unwritable). This catches the cost
  // of that choice: a column added in a migration and never reflected in the type.
  console.log("\n== database.types.ts is in sync with the schema ==");
  const typesSrc = await readFile(
    path.resolve(import.meta.dirname, "..", "src", "lib", "supabase", "database.types.ts"),
    "utf8",
  );
  const { rows: allCols } = await client.query(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public' and table_name = any($1)`,
    [TABLES],
  );
  const missing = allCols.filter(
    (c) => !new RegExp(`\\b${c.column_name}\\b`).test(typesSrc),
  );
  check("every column appears in database.types.ts", missing.length === 0,
    missing.map((c) => `${c.table_name}.${c.column_name}`).join(", "));

  console.log("\n== realtime publication ==");
  const { rows: pub } = await client.query(
    `select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'`,
  );
  const pubTables = pub.map((p) => p.tablename);
  check("connections is published for Realtime", pubTables.includes("connections"));
  check("notifications is published for Realtime", pubTables.includes("notifications"));
  check("profile_change_events is NOT published (internal only)",
    !pubTables.includes("profile_change_events"));
  check("contact_details is NOT published (would stream phone/email diffs)",
    !pubTables.includes("contact_details"));
} finally {
  await client.end();
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
process.exitCode = failures > 0 ? 1 : 0;
