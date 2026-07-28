import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { connect } from "./db.mjs";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "..", "supabase", "migrations");

/**
 * Applies pending migrations in filename order, one transaction per file, and
 * records them in `supabase_migrations.schema_migrations` — the same ledger the
 * Supabase CLI uses, so a later `supabase db push` sees these as already applied
 * instead of trying to re-run them.
 */
async function main() {
  const client = await connect();
  console.log("connected\n");

  try {
    await client.query(`create schema if not exists supabase_migrations`);
    await client.query(`
      create table if not exists supabase_migrations.schema_migrations (
        version text primary key,
        statements text[],
        name text
      )
    `);

    const { rows: applied } = await client.query(
      `select version from supabase_migrations.schema_migrations`,
    );
    const alreadyApplied = new Set(applied.map((r) => r.version));

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let ran = 0;
    for (const file of files) {
      const version = file.split("_")[0];
      if (alreadyApplied.has(version)) {
        console.log(`  skip  ${file} (already applied)`);
        continue;
      }

      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      process.stdout.write(`  apply ${file} ... `);

      // One transaction per file: a failure rolls that file back completely
      // rather than leaving the schema half-built.
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          `insert into supabase_migrations.schema_migrations (version, name, statements)
           values ($1, $2, $3)`,
          [version, file.replace(/^\d+_/, "").replace(/\.sql$/, ""), [sql]],
        );
        await client.query("commit");
        console.log("ok");
        ran += 1;
      } catch (error) {
        await client.query("rollback");
        console.log("FAILED");
        console.error(`\n${error.message}`);
        if (error.position) {
          const pos = Number(error.position);
          const upto = sql.slice(0, pos);
          const line = upto.split("\n").length;
          console.error(`  at ${file}:${line}`);
          console.error(`  near: ${sql.slice(Math.max(0, pos - 120), pos + 120).trim()}`);
        }
        if (error.hint) console.error(`  hint: ${error.hint}`);
        if (error.detail) console.error(`  detail: ${error.detail}`);
        process.exitCode = 1;
        return;
      }
    }

    console.log(`\n${ran} migration(s) applied, ${files.length - ran} skipped.`);
  } finally {
    await client.end();
  }
}

await main();
