import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, migrate } from "../server/database.js";
import { createHandler } from "../server/app.js";
import { hashPassword, verifyPassword } from "../server/security.js";
let db, server, origin, directory;
const password = "test-password-very-long";
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "dark-archive-tests-"));
  db = await createDatabase({ url: "", dataDir: directory, local: true });
  server = createServer(
    createHandler({
      getDatabase: async () => db,
      secureCookies: false,
      logError: () => {},
    }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
  await rm(directory, { recursive: true, force: true });
});
async function request(
  path,
  { method = "GET", body, cookie, headers = {} } = {},
) {
  const response = await fetch(origin + "/api" + path, {
    method,
    headers: {
      ...(method === "GET"
        ? {}
        : {
            "Content-Type": "application/json",
            "X-Archive-Request": "1",
            Origin: origin,
          }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
    headers: response.headers,
  };
}
async function register(username) {
  const result = await request("/auth/register", {
    method: "POST",
    body: { username, name: username, password },
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result;
}
let author, reader, other, story, seriesId;
test("fresh schema preserves original stories and migration is idempotent", async () => {
  await migrate(db);
  const result = await request("/catalog");
  assert.equal(result.status, 200);
  assert.equal(result.data.articles.length, 2);
  assert.equal(result.data.articles[0].content, undefined);
  assert.equal(result.headers.get("cache-control"), "no-store");
});
test("registration hashes passwords, returns no secrets and issues an HttpOnly session", async () => {
  author = await register("author");
  reader = await register("reader");
  other = await register("other");
  assert.equal(reader.data.user.role, "reader");
  assert.equal(reader.data.user.password_hash, undefined);
  assert.match(reader.headers.get("set-cookie"), /HttpOnly/);
  assert.match(reader.headers.get("set-cookie"), /SameSite=Lax/);
  const { rows } = await db.query(
    "SELECT password_hash FROM users WHERE id=$1",
    [reader.data.user.id],
  );
  assert.notEqual(rows[0].password_hash, password);
  assert.equal(await verifyPassword(password, rows[0].password_hash), true);
  const storedSession = await db.query(
    "SELECT token_hash FROM sessions WHERE user_id=$1",
    [reader.data.user.id],
  );
  assert.notEqual(
    storedSession.rows[0].token_hash,
    reader.cookie.split("=")[1],
  );
  assert.equal(
    (await request("/session", { cookie: reader.cookie })).data.user.id,
    reader.data.user.id,
  );
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [
    author.data.user.id,
  ]);
});
test("fake admin flags, anonymous mutation and readers cannot access author functions", async () => {
  assert.equal(
    (await request("/admin/catalog", { headers: { Cookie: "admin=true" } }))
      .status,
    401,
  );
  assert.equal(
    (await request("/admin/catalog", { cookie: reader.cookie })).status,
    403,
  );
  assert.equal(
    (
      await request("/admin/articles", {
        method: "POST",
        body: { title: "Break" },
      })
    ).status,
    401,
  );
});
test("CSRF origin and content type checks reject foreign requests", async () => {
  assert.equal(
    (
      await request("/auth/logout", {
        method: "POST",
        cookie: reader.cookie,
        headers: { Origin: "https://foreign.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/auth/logout", {
        method: "POST",
        cookie: reader.cookie,
        headers: { "X-Archive-Request": "" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/auth/logout", {
        method: "POST",
        cookie: reader.cookie,
        headers: { "Content-Type": "text/plain" },
      })
    ).status,
    415,
  );
  assert.ok((await request("/session", { cookie: reader.cookie })).data.user);
});
test("author creates series and drafts; draft content is hidden from readers and catalog", async () => {
  const result = await request("/admin/series", {
    method: "POST",
    cookie: author.cookie,
    body: { title: "Кривой Наволок", description: "Экспедиция возвращается." },
  });
  assert.equal(result.status, 201);
  seriesId = result.data.id;
  const created = await request("/admin/articles", {
    method: "POST",
    cookie: author.cookie,
    body: {
      title: "Закрытое дело",
      content: "Это длинная история.\n\nЕщё один абзац.",
      seriesId,
      episode: 1,
    },
  });
  assert.equal(created.status, 201);
  story = created.data.id;
  assert.equal((await request(`/articles/${story}`)).status, 404);
  assert.equal(
    (await request(`/articles/${story}`, { cookie: reader.cookie })).status,
    404,
  );
  assert.equal(
    (await request(`/articles/${story}`, { cookie: author.cookie })).status,
    200,
  );
  assert.equal(
    (await request("/catalog")).data.articles.some((a) => a.id === story),
    false,
  );
  assert.equal((await request("/catalog")).data.series.length, 0);
});
test("publication keeps URL stable through title edits; unique series numbers enforced", async () => {
  const beforeEdit = (
    await request(`/articles/${story}`, { cookie: author.cookie })
  ).data.article;
  const body = {
    ...beforeEdit,
    title: "Возвращение экспедиции",
    status: "published",
  };
  assert.equal(
    (
      await request(`/admin/articles/${story}`, {
        method: "PUT",
        cookie: author.cookie,
        body,
      })
    ).status,
    200,
  );
  const result = await request(`/articles/${beforeEdit.slug}`);
  assert.equal(result.status, 200);
  assert.equal(result.data.article.title, body.title);
  assert.equal(result.data.article.slug, beforeEdit.slug);
  assert.equal((await request("/catalog")).data.series[0].episodeCount, 1);
  const duplicate = await request("/admin/articles", {
    method: "POST",
    cookie: author.cookie,
    body,
  });
  assert.equal(duplicate.status, 409);
  const second = await request("/admin/articles", {
    method: "POST",
    cookie: author.cookie,
    body: { ...body, title: "Вторая часть", episode: 2 },
  });
  assert.equal(second.status, 201);
  const episodes = (await request(`/articles/${story}`)).data.episodes;
  assert.deepEqual(
    episodes.map((e) => e.episode),
    [1, 2],
  );
});
test("likes and bookmarks are idempotent and private per user", async () => {
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await request(`/articles/${story}/like`, {
          method: "PUT",
          cookie: reader.cookie,
          body: { active: true },
        })
      ).status,
      200,
    );
  assert.equal((await request(`/articles/${story}`)).data.article.likeCount, 1);
  assert.equal(
    (await request(`/articles/${story}`, { cookie: reader.cookie })).data
      .article.liked,
    true,
  );
  assert.equal(
    (await request(`/articles/${story}`, { cookie: other.cookie })).data.article
      .liked,
    false,
  );
  await request(`/articles/${story}/bookmark`, {
    method: "PUT",
    cookie: reader.cookie,
    body: { active: true },
  });
  assert.equal(
    (await request("/me/library", { cookie: reader.cookie })).data.articles
      .length,
    1,
  );
  assert.equal(
    (await request("/me/library", { cookie: other.cookie })).data.articles
      .length,
    0,
  );
  await request(`/articles/${story}/like`, {
    method: "PUT",
    cookie: reader.cookie,
    body: { active: false },
  });
  assert.equal((await request(`/articles/${story}`)).data.article.likeCount, 0);
});
test("reading progress survives sessions, belongs to its user and rejects invalid values", async () => {
  assert.equal(
    (
      await request(`/articles/${story}/progress`, {
        method: "PUT",
        cookie: reader.cookie,
        body: { paragraph: 1, percent: 65 },
      })
    ).status,
    200,
  );
  assert.deepEqual(
    (await request(`/articles/${story}`, { cookie: reader.cookie })).data
      .progress,
    { paragraph: 1, percent: 65 },
  );
  assert.equal(
    (await request(`/articles/${story}`, { cookie: other.cookie })).data
      .progress,
    null,
  );
  assert.equal(
    (
      await request(`/articles/${story}/progress`, {
        method: "PUT",
        cookie: reader.cookie,
        body: { paragraph: -1, percent: 200 },
      })
    ).status,
    400,
  );
  assert.equal(
    (await request("/me/library", { cookie: reader.cookie })).data.articles[0]
      .percent,
    65,
  );
});
test("comment ownership enforced; submitted markup is stored only as text", async () => {
  const text = "<script>alert(1)</script> Это хороший рассказ.";
  const created = await request(`/articles/${story}/comments`, {
    method: "POST",
    cookie: reader.cookie,
    body: { text },
  });
  assert.equal(created.status, 201);
  const id = created.data.comment.id;
  assert.equal(
    (await request(`/articles/${story}`)).data.comments[0].text,
    text,
  );
  assert.equal(
    (
      await request(`/comments/${id}`, {
        method: "DELETE",
        cookie: other.cookie,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(`/comments/${id}`, {
        method: "DELETE",
        cookie: author.cookie,
      })
    ).status,
    200,
  );
});
test("feedback is visible only to the author", async () => {
  const result = await request("/feedback", {
    method: "POST",
    cookie: reader.cookie,
    body: { text: "Предлагаю историю про заброшенную деревню." },
  });
  assert.equal(result.status, 201);
  assert.equal(
    (await request("/admin/catalog", { cookie: author.cookie })).data.feedback
      .length,
    1,
  );
  assert.equal(
    (await request("/admin/catalog", { cookie: reader.cookie })).status,
    403,
  );
});
test("imports are drafts, skip duplicates and reject a partial invalid batch atomically", async () => {
  const imported = {
    title: "Импортированная статья",
    slug: "imported-story",
    content: "Текст ранее сохранённой истории.",
    status: "published",
    sourceUrl: "https://dzen.ru/a/test",
  };
  let result = await request("/admin/import", {
    method: "POST",
    cookie: author.cookie,
    body: { articles: [imported] },
  });
  assert.equal(result.status, 201);
  assert.equal(result.data.imported, 1);
  assert.equal((await request("/articles/imported-story")).status, 404);
  result = await request("/admin/import", {
    method: "POST",
    cookie: author.cookie,
    body: { articles: [imported] },
  });
  assert.equal(result.data.skipped, 1);
  const before = (await request("/admin/catalog", { cookie: author.cookie }))
    .data.articles.length;
  result = await request("/admin/import", {
    method: "POST",
    cookie: author.cookie,
    body: {
      articles: [
        { ...imported, slug: "second-import" },
        { title: "Invalid", content: "" },
      ],
    },
  });
  assert.equal(result.status, 400);
  assert.equal(
    (await request("/admin/catalog", { cookie: author.cookie })).data.articles
      .length,
    before,
  );
});
test("unsafe URLs, impossible dates and malformed article payloads rejected", async () => {
  const body = {
    title: "Тестовая статья",
    content: "Достаточно длинный текст.",
  };
  for (const patch of [
    { cover: "javascript:alert(1)" },
    { sourceUrl: "https://example.com/a" },
    { date: "2026-02-30" },
    { seriesId, episode: "abc" },
  ]) {
    assert.equal(
      (
        await request("/admin/articles", {
          method: "POST",
          cookie: author.cookie,
          body: { ...body, ...patch },
        })
      ).status,
      400,
    );
  }
  assert.equal(
    (
      await request("/feedback", {
        method: "POST",
        cookie: reader.cookie,
        body: null,
      })
    ).status,
    400,
  );
});
test("deletion cascades likes, comments, bookmarks and reading positions", async () => {
  assert.equal(
    (
      await request(`/admin/articles/${story}`, {
        method: "DELETE",
        cookie: author.cookie,
      })
    ).status,
    200,
  );
  assert.equal((await request(`/articles/${story}`)).status, 404);
  assert.equal(
    (await request("/me/library", { cookie: reader.cookie })).data.articles
      .length,
    0,
  );
});
test("passwords retain whitespace; wrong login, duplicate registration and rate limits work", async () => {
  const spaced = "  spaces-stay-in-password  ";
  const hash = await hashPassword(spaced);
  assert.equal(await verifyPassword(spaced, hash), true);
  assert.equal(await verifyPassword(spaced.trim(), hash), false);
  const bad = await request("/auth/login", {
    method: "POST",
    body: { username: "reader", password: "wrong-password-long" },
  });
  assert.equal(bad.status, 401);
  assert.equal(
    (
      await request("/auth/register", {
        method: "POST",
        body: { username: "reader", password },
      })
    ).status,
    409,
  );
  let limited;
  for (let i = 0; i < 11; i++)
    limited = await request("/auth/login", {
      method: "POST",
      body: { username: "unknown", password: "incorrect-password-long" },
    });
  assert.equal(limited.status, 429);
});
test("logout invalidates session and expired sessions cannot authenticate", async () => {
  const result = await request("/auth/logout", {
    method: "POST",
    cookie: other.cookie,
  });
  assert.equal(result.status, 200);
  assert.match(result.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(
    (await request("/session", { cookie: other.cookie })).data.user,
    null,
  );
  await db.query(
    "UPDATE sessions SET expires_at=NOW()-INTERVAL '1 day' WHERE user_id=$1",
    [reader.data.user.id],
  );
  assert.equal(
    (await request("/session", { cookie: reader.cookie })).data.user,
    null,
  );
});
test("production refuses ephemeral database fallback", async () => {
  await assert.rejects(
    createDatabase({ url: "", local: false }),
    /DATABASE_URL/,
  );
  const unavailable = createServer(
    createHandler({
      getDatabase: async () => {
        throw Object.assign(new Error("private connection string"), {
          status: 503,
        });
      },
      logError: () => {},
    }),
  );
  await new Promise((resolve) => unavailable.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(
      `http://127.0.0.1:${unavailable.address().port}/api/catalog`,
    );
    const data = await response.json();
    assert.equal(response.status, 503);
    assert.doesNotMatch(data.error, /private/);
  } finally {
    await new Promise((resolve) => unavailable.close(resolve));
  }
});

test("sitemap lists only published stories and rewrite routing preserves API paths", async () => {
  const response = await fetch(origin + "/api/sitemap");
  const xml = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/xml/);
  assert.match(xml, /delo-731b-mertvyi-hutor/);
  assert.doesNotMatch(xml, /imported-story/);
  const rewritten = await request("?__archivePath=catalog");
  assert.equal(rewritten.status, 200);
  assert.ok(rewritten.data.articles.length);
});
test("local data survives closing and reopening the database", async () => {
  await db.close();
  db = await createDatabase({ url: "", dataDir: directory, local: true });
  assert.equal(
    (await request("/admin/catalog", { cookie: author.cookie })).data.feedback
      .length,
    1,
  );
  assert.equal(
    (await request("/articles/imported-story", { cookie: author.cookie })).data
      .article.status,
    "draft",
  );
});
