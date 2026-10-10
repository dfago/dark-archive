import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, migrate } from "../server/database.js";
import { createHandler } from "../server/app.js";
import { verifyPassword } from "../server/security.js";

const token = "a".repeat(64);
const password = "owner-test-password-long";
let db, server, origin, directory, settings;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "archive-owner-tests-"));
  db = await createDatabase({ url: "", dataDir: directory, local: true });
  server = createServer((request, response) =>
    createHandler({
      getDatabase: async () => db,
      secureCookies: true,
      logError: () => {},
      ...settings,
    })(request, response),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => {
  await db.query("TRUNCATE owner_setup,users,rate_limits CASCADE");
  settings = {
    setupToken: token,
    setupExpiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
  await rm(directory, { recursive: true, force: true });
});
async function request(
  path,
  { body, method = body ? "POST" : "GET", cookie, headers = {} } = {},
) {
  const response = await fetch(origin + "/api" + path, {
    method,
    headers: {
      ...(body
        ? {
            "Content-Type": "application/json",
            "X-Archive-Request": "1",
            Origin: origin,
          }
        : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("set-cookie"),
    headers: response.headers,
  };
}
const owner = (extra = {}) => ({
  token,
  username: "owner",
  name: "Артём",
  password,
  ...extra,
});

test("owner setup fails closed without a strong token and a future deadline", async () => {
  const future = settings.setupExpiresAt;
  for (const config of [
    { setupToken: undefined, setupExpiresAt: undefined },
    { setupToken: "weak", setupExpiresAt: future },
    { setupToken: token, setupExpiresAt: "invalid" },
    {
      setupToken: token,
      setupExpiresAt: new Date(Date.now() - 1000).toISOString(),
    },
  ]) {
    settings = config;
    assert.deepEqual((await request("/owner/setup")).data, { enabled: false });
    assert.equal(
      (await request("/owner/setup", { body: owner() })).status,
      404,
    );
  }
  assert.equal((await db.query("SELECT id FROM users")).rows.length, 0);
});
test("foreign origin and invalid tokens cannot create an owner or consume setup", async () => {
  assert.equal(
    (
      await request("/owner/setup", {
        body: owner(),
        headers: { Origin: "https://foreign.example" },
      })
    ).status,
    403,
  );
  for (const invalid of ["", "b".repeat(64), "x".repeat(200)]) {
    const result = await request("/owner/setup", {
      body: owner({ token: invalid }),
    });
    assert.equal(result.status, 403);
    assert.doesNotMatch(JSON.stringify(result.data), new RegExp(token));
  }
  assert.deepEqual((await request("/owner/setup")).data, { enabled: true });
  assert.equal(
    (await db.query("SELECT user_id FROM owner_setup")).rows.length,
    0,
  );
});
test("invalid passwords do not consume the link or insert an account", async () => {
  assert.equal(
    (await request("/owner/setup", { body: owner({ password: "short" }) }))
      .status,
    400,
  );
  assert.equal((await db.query("SELECT id FROM users")).rows.length, 0);
  assert.deepEqual((await request("/owner/setup")).data, { enabled: true });
});
test("one-time setup creates a hashed administrator and a secure working session", async () => {
  const result = await request("/owner/setup", { body: owner() });
  assert.equal(result.status, 201);
  assert.equal(result.data.user.role, "admin");
  assert.equal(result.data.user.password_hash, undefined);
  assert.match(result.cookie, /HttpOnly/);
  assert.match(result.cookie, /SameSite=Lax/);
  assert.match(result.cookie, /Secure/);
  const stored = (
    await db.query("SELECT password_hash FROM users WHERE id=$1", [
      result.data.user.id,
    ])
  ).rows[0];
  assert.ok(await verifyPassword(password, stored.password_hash));
  const cookie = result.cookie.split(";")[0];
  assert.equal((await request("/session", { cookie })).data.user.role, "admin");
  assert.equal((await request("/admin/catalog", { cookie })).status, 200);
  assert.deepEqual((await request("/owner/setup")).data, { enabled: false });
  assert.equal(
    (
      await request("/owner/setup", {
        body: owner({ username: "second-owner" }),
      })
    ).status,
    409,
  );
  await migrate(db);
  await db.close();
  db = await createDatabase({ url: "", dataDir: directory, local: true });
  // The consumed marker closes setup even if a privileged database operator changes the role.
  await db.query("UPDATE users SET role='reader'");
  assert.equal(
    (
      await request("/owner/setup", {
        body: owner({ username: "third-owner" }),
      })
    ).status,
    409,
  );
});
test("setup never promotes an existing reader or replaces their password", async () => {
  const reader = await request("/auth/register", {
    body: { username: "owner", name: "Reader", password },
  });
  assert.equal(reader.status, 201);
  assert.equal((await request("/owner/setup", { body: owner() })).status, 409);
  assert.equal(
    (await db.query("SELECT role FROM users WHERE username='owner'")).rows[0]
      .role,
    "reader",
  );
  assert.deepEqual((await request("/owner/setup")).data, { enabled: true });
});
test("concurrent claims allow exactly one owner; existing administrators close setup", async () => {
  const results = await Promise.all([
    request("/owner/setup", { body: owner({ username: "first" }) }),
    request("/owner/setup", { body: owner({ username: "second" }) }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  assert.equal(
    (await db.query("SELECT id FROM users WHERE role='admin'")).rows.length,
    1,
  );
  await db.query("DELETE FROM owner_setup");
  assert.deepEqual((await request("/owner/setup")).data, { enabled: false });
  assert.equal(
    (await request("/owner/setup", { body: owner({ username: "third" }) }))
      .status,
    409,
  );
});
test("an upgrade from migration 001 preserves existing stories and installs owner setup once", async () => {
  const article = (await db.query("SELECT id,title FROM articles LIMIT 1"))
    .rows[0];
  await db.query("DROP TABLE owner_setup");
  await db.query("DELETE FROM schema_migrations WHERE version='002'");
  await db.query("UPDATE articles SET title=$1 WHERE id=$2", [
    "Сохранённая история",
    article.id,
  ]);
  await migrate(db);
  await migrate(db);
  assert.equal(
    (await db.query("SELECT title FROM articles WHERE id=$1", [article.id]))
      .rows[0].title,
    "Сохранённая история",
  );
  assert.equal(
    (
      await db.query(
        "SELECT version FROM schema_migrations WHERE version='002'",
      )
    ).rows.length,
    1,
  );
  assert.deepEqual((await request("/owner/setup")).data, { enabled: true });
});
