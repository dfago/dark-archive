import { readFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { starterArticles } from "../src/starter-articles.js";

export async function createDatabase({
  url = process.env.DATABASE_URL,
  dataDir = process.env.PGLITE_DATA_DIR || ".data/postgres",
  local = !process.env.VERCEL && process.env.NODE_ENV !== "production",
} = {}) {
  let db;
  if (url) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({
      connectionString: url,
      max: 3,
      connectionTimeoutMillis: 10000,
    });
    db = {
      query: (sql, params = []) => pool.query(sql, params),
      close: () => pool.end(),
      transaction: async (callback) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await callback(client);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
      postgres: true,
    };
  } else {
    if (!local)
      throw Object.assign(new Error("DATABASE_URL is required in production"), {
        status: 503,
        publicMessage: "Сервис временно недоступен. Попробуйте позже.",
      });
    await mkdir(dirname(resolve(dataDir)), { recursive: true });
    const { PGlite } = await import("@electric-sql/pglite");
    const instance = new PGlite(dataDir);
    await instance.waitReady;
    db = {
      query: (sql, params = []) => instance.query(sql, params),
      transaction: (callback) => instance.transaction(callback),
      close: () => instance.close(),
      postgres: false,
    };
  }
  try {
    await migrate(db);
  } catch (error) {
    await db.close();
    throw error;
  }
  return db;
}

export async function migrate(db) {
  const sql = await readFile(
    new URL("./migrations/001_initial.sql", import.meta.url),
    "utf8",
  );
  await db.transaction(async (tx) => {
    if (db.postgres) await tx.query("SELECT pg_advisory_xact_lock(19472026)");
    await tx.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
    );
    const existing = await tx.query(
      "SELECT version FROM schema_migrations WHERE version = $1",
      ["001"],
    );
    if (existing.rows.length) return;
    // Both drivers support individual statements; no interpolated user content.
    for (const statement of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await tx.query(statement);
    for (const article of starterArticles) {
      await tx.query(
        "INSERT INTO articles (id,title,slug,excerpt,cover,content,status,date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING",
        [
          article.id,
          article.title,
          article.slug,
          article.excerpt,
          article.cover,
          article.content,
          article.status,
          article.date,
        ],
      );
    }
    await tx.query("INSERT INTO schema_migrations (version) VALUES ($1)", [
      "001",
    ]);
  });
}
