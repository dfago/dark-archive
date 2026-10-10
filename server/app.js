import { randomUUID } from "node:crypto";
import {
  hashPassword,
  verifyPassword,
  httpError,
  textField,
  passwordField,
  safeURL,
  slugify,
  createSession,
  currentUser,
  sessionToken,
  digest,
  checkMutation,
  rateLimit,
} from "./security.js";

const publicUser = ({ id, username, name, role }) => ({
  id,
  username,
  name,
  role,
});
const dateString = (value) =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
const articleFields = `a.id,a.title,a.slug,a.excerpt,a.cover,a.status,a.date,a.series_id AS "seriesId",a.episode,a.source_url AS "sourceUrl",s.title AS "seriesTitle",s.slug AS "seriesSlug",(SELECT COUNT(*)::integer FROM likes l WHERE l.article_id=a.id) AS "likeCount",EXISTS(SELECT 1 FROM likes l WHERE l.article_id=a.id AND l.user_id=$1) AS liked,EXISTS(SELECT 1 FROM bookmarks b WHERE b.article_id=a.id AND b.user_id=$1) AS bookmarked`;
const mapArticle = (row) => ({ ...row, date: dateString(row.date) });

async function readBody(request) {
  const max = 2 * 1024 * 1024;
  if (request.body !== undefined) {
    if (
      Buffer.byteLength(
        typeof request.body === "string"
          ? request.body
          : JSON.stringify(request.body),
      ) > max
    )
      throw httpError(413, "Данные слишком большие.");
    try {
      return typeof request.body === "string"
        ? JSON.parse(request.body)
        : request.body;
    } catch {
      throw httpError(400, "Некорректный JSON.");
    }
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > max) throw httpError(413, "Данные слишком большие.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    throw httpError(400, "Некорректный JSON.");
  }
}
function validateArticle(body, { imported = false } = {}) {
  const title = textField(body.title, "Заголовок", 3, 180);
  const content = textField(body.content, "Текст статьи", 10, 300000);
  const excerpt = textField(body.excerpt || "", "Описание", 0, 1000);
  const cover = safeURL(body.cover || "");
  const sourceUrl = safeURL(body.sourceUrl || body.source_url || "", {
    source: true,
  });
  const status = imported ? "draft" : (body.status ?? "draft");
  if (!["draft", "published"].includes(status))
    throw httpError(400, "Неверный статус статьи.");
  const seriesId = body.seriesId || null;
  const episode = seriesId ? Number(body.episode) : null;
  if (
    seriesId &&
    (typeof seriesId !== "string" ||
      !Number.isInteger(episode) ||
      episode < 1 ||
      episode > 9999)
  )
    throw httpError(400, "Укажите номер части в серии.");
  const date = body.date || new Date().toISOString().slice(0, 10);
  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(new Date(date).getTime()) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    throw httpError(400, "Неверная дата.");
  return {
    title,
    content,
    excerpt,
    cover,
    sourceUrl,
    status,
    seriesId,
    episode,
    date,
  };
}
async function insertArticle(db, data, slug) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO articles (id,title,slug,excerpt,cover,content,status,date,series_id,episode,source_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [
      id,
      data.title,
      slug,
      data.excerpt,
      data.cover,
      data.content,
      data.status,
      data.date,
      data.seriesId,
      data.episode,
      data.sourceUrl,
    ],
  );
  return id;
}

export function createHandler({
  getDatabase,
  siteURL = process.env.SITE_URL,
  secureCookies = Boolean(process.env.VERCEL) ||
    (siteURL
      ? new URL(siteURL).protocol === "https:"
      : process.env.NODE_ENV === "production"),
  logError = console.error,
} = {}) {
  return async function handler(request, response) {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const send = (status, body) => {
      response.statusCode = status;
      response.end(JSON.stringify(body));
    };
    try {
      const url = new URL(request.url, "http://localhost");
      const rewritePath =
        request.query?.__archivePath ?? url.searchParams.get("__archivePath");
      const path = (
        rewritePath !== null && rewritePath !== undefined
          ? `/api/${String(rewritePath)}`
          : url.pathname
      ).replace(/\/$/, "");
      const method = request.method;
      if (!["GET", "POST", "PUT", "DELETE"].includes(method))
        throw httpError(405, "Метод не поддерживается.");
      if (method !== "GET") checkMutation(request, siteURL);
      const db = await getDatabase();
      if (["/api/sitemap", "/api/robots"].includes(path) && method === "GET") {
        const origin = siteURL
          ? new URL(siteURL).origin
          : `${process.env.VERCEL || process.env.NODE_ENV === "production" ? "https" : "http"}://${request.headers.host}`;
        if (path === "/api/robots") {
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          response.statusCode = 200;
          return response.end(
            `User-agent: *\nAllow: /\nDisallow: /author\nDisallow: /library\nDisallow: /login\nDisallow: /api/\nSitemap: ${origin}/sitemap.xml\n`,
          );
        }
        const { rows } = await db.query(
          "SELECT slug FROM articles WHERE status='published'",
        );
        const escape = (value) =>
          value
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;");
        const locations = [
          origin + "/",
          ...rows.map(
            (row) => origin + "/story/" + encodeURIComponent(row.slug),
          ),
        ];
        response.setHeader("Content-Type", "application/xml; charset=utf-8");
        response.statusCode = 200;
        return response.end(
          `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locations.map((loc) => `<url><loc>${escape(loc)}</loc></url>`).join("")}</urlset>`,
        );
      }
      if (path === "/api/health" && method === "GET") {
        await db.query("SELECT 1");
        return send(200, { ok: true });
      }
      const user = await currentUser(db, request);
      const requireUser = () => {
        if (!user) throw httpError(401, "Войдите в свой аккаунт.");
        return user;
      };
      const requireAdmin = () => {
        requireUser();
        if (user.role !== "admin")
          throw httpError(403, "Доступ только для автора.");
      };
      const body = method !== "GET" ? await readBody(request) : {};
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw httpError(400, "Ожидается объект данных.");

      if (path === "/api/session" && method === "GET")
        return send(200, { user });
      if (
        ["/api/auth/register", "/api/auth/login"].includes(path) &&
        method === "POST"
      ) {
        const ip = process.env.VERCEL
          ? String(request.headers["x-forwarded-for"] || "")
              .split(",")[0]
              .trim()
          : request.socket?.remoteAddress || "local";
        await rateLimit(db, `auth:${ip}`, 20, 900);
        const username = textField(body.username, "Логин", 3, 40).toLowerCase();
        if (!/^[a-zа-яё0-9_.-]+$/i.test(username))
          throw httpError(
            400,
            "Логин: буквы, цифры, точка, дефис или подчёркивание.",
          );
        const password = passwordField(body.password);
        let account;
        if (path.endsWith("register")) {
          await rateLimit(db, `signup:${ip}`, 5, 3600);
          const name = textField(body.name || body.username, "Имя", 2, 60);
          const id = randomUUID();
          const passwordHash = await hashPassword(password);
          const { rows } = await db.query(
            "INSERT INTO users (id,username,name,password_hash) VALUES ($1,$2,$3,$4) RETURNING id,username,name,role",
            [id, username, name, passwordHash],
          );
          account = rows[0];
        } else {
          await rateLimit(db, `login:${username}`, 10, 900);
          const { rows } = await db.query(
            "SELECT * FROM users WHERE username=$1",
            [username],
          );
          account = rows[0];
          // Run the same expensive operation when the user does not exist.
          const valid = await verifyPassword(
            password,
            account?.password_hash ||
              "scrypt:00000000000000000000000000000000:" + "00".repeat(64),
          );
          if (!account || !valid)
            throw httpError(401, "Неверный логин или пароль.");
        }
        const oldToken = sessionToken(request);
        if (oldToken)
          await db.query("DELETE FROM sessions WHERE token_hash=$1", [
            digest(oldToken),
          ]);
        await createSession(db, account.id, response, secureCookies);
        return send(path.endsWith("register") ? 201 : 200, {
          user: publicUser(account),
        });
      }
      if (path === "/api/auth/logout" && method === "POST") {
        await db.query("DELETE FROM sessions WHERE token_hash=$1", [
          digest(sessionToken(request)),
        ]);
        response.setHeader(
          "Set-Cookie",
          `archive_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookies ? "; Secure" : ""}`,
        );
        return send(200, { ok: true });
      }
      if (path === "/api/catalog" && method === "GET") {
        const { rows } = await db.query(
          `SELECT ${articleFields},CEIL(GREATEST(1,LENGTH(a.content)/1000.0))::integer AS "readMinutes" FROM articles a LEFT JOIN series s ON s.id=a.series_id WHERE a.status='published' ORDER BY a.date DESC,a.created_at DESC`,
          [user?.id || null],
        );
        const series = await db.query(
          `SELECT s.id,s.title,s.slug,s.description,COUNT(a.id)::integer AS "episodeCount" FROM series s JOIN articles a ON a.series_id=s.id AND a.status='published' GROUP BY s.id ORDER BY s.created_at DESC`,
        );
        return send(200, {
          articles: rows.map(mapArticle),
          series: series.rows,
        });
      }
      if (path === "/api/me/library" && method === "GET") {
        requireUser();
        const { rows } = await db.query(
          `SELECT ${articleFields},p.paragraph,p.percent,p.updated_at AS "lastReadAt" FROM articles a LEFT JOIN series s ON s.id=a.series_id LEFT JOIN reading_progress p ON p.article_id=a.id AND p.user_id=$1 WHERE a.status='published' AND (p.user_id IS NOT NULL OR EXISTS(SELECT 1 FROM bookmarks b WHERE b.article_id=a.id AND b.user_id=$1)) ORDER BY p.updated_at DESC NULLS LAST,a.date DESC`,
          [user.id],
        );
        return send(200, { articles: rows.map(mapArticle) });
      }
      if (path === "/api/feedback" && method === "POST") {
        requireUser();
        await rateLimit(db, `feedback:${user.id}`, 5, 3600);
        const text = textField(body.text, "Сообщение", 10, 4000);
        await db.query(
          "INSERT INTO feedback (id,user_id,text) VALUES ($1,$2,$3)",
          [randomUUID(), user.id, text],
        );
        return send(201, { ok: true });
      }
      const articleMatch = path.match(
        /^\/api\/articles\/([^/]+)(?:\/(like|bookmark|progress|comments))?$/,
      );
      if (articleMatch) {
        const key = decodeURIComponent(articleMatch[1]);
        const action = articleMatch[2];
        const { rows } = await db.query(
          `SELECT ${articleFields},a.content FROM articles a LEFT JOIN series s ON s.id=a.series_id WHERE (a.id=$2 OR a.slug=$2) AND (a.status='published' OR $3::boolean)`,
          [user?.id || null, key, user?.role === "admin"],
        );
        const article = rows[0];
        if (!article) throw httpError(404, "История не найдена.");
        if (!action && method === "GET") {
          const comments = await db.query(
            'SELECT c.id,c.text,c.created_at AS date,u.name AS author,c.user_id AS "userId" FROM comments c JOIN users u ON u.id=c.user_id WHERE c.article_id=$1 ORDER BY c.created_at LIMIT 200',
            [article.id],
          );
          const progress = user
            ? await db.query(
                "SELECT paragraph,percent FROM reading_progress WHERE article_id=$1 AND user_id=$2",
                [article.id, user.id],
              )
            : { rows: [] };
          const episodes = article.seriesId
            ? await db.query(
                "SELECT id,title,slug,episode FROM articles WHERE series_id=$1 AND status='published' ORDER BY episode",
                [article.seriesId],
              )
            : { rows: [] };
          return send(200, {
            article: mapArticle(article),
            comments: comments.rows,
            progress: progress.rows[0] || null,
            episodes: episodes.rows,
          });
        }
        if (["like", "bookmark"].includes(action) && method === "PUT") {
          requireUser();
          if (typeof body.active !== "boolean")
            throw httpError(400, "Укажите действие.");
          const table = action === "like" ? "likes" : "bookmarks";
          if (body.active)
            await db.query(
              `INSERT INTO ${table} (article_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
              [article.id, user.id],
            );
          else
            await db.query(
              `DELETE FROM ${table} WHERE article_id=$1 AND user_id=$2`,
              [article.id, user.id],
            );
          const count = await db.query(
            "SELECT COUNT(*)::integer AS count FROM likes WHERE article_id=$1",
            [article.id],
          );
          return send(200, {
            active: body.active,
            likeCount: count.rows[0].count,
          });
        }
        if (action === "progress" && method === "PUT") {
          requireUser();
          if (
            !Number.isInteger(body.paragraph) ||
            body.paragraph < 0 ||
            body.paragraph > 100000 ||
            !Number.isInteger(body.percent) ||
            body.percent < 0 ||
            body.percent > 100
          )
            throw httpError(400, "Некорректная позиция чтения.");
          await db.query(
            "INSERT INTO reading_progress (article_id,user_id,paragraph,percent) VALUES ($1,$2,$3,$4) ON CONFLICT (article_id,user_id) DO UPDATE SET paragraph=EXCLUDED.paragraph,percent=EXCLUDED.percent,updated_at=NOW()",
            [article.id, user.id, body.paragraph, body.percent],
          );
          return send(200, { ok: true });
        }
        if (action === "comments" && method === "POST") {
          requireUser();
          await rateLimit(db, `comment:${user.id}`, 10, 600);
          const text = textField(body.text, "Комментарий", 2, 2000);
          const id = randomUUID();
          const { rows } = await db.query(
            "INSERT INTO comments (id,article_id,user_id,text) VALUES ($1,$2,$3,$4) RETURNING id,text,created_at AS date",
            [id, article.id, user.id, text],
          );
          return send(201, {
            comment: { ...rows[0], author: user.name, userId: user.id },
          });
        }
        throw httpError(405, "Метод не поддерживается.");
      }
      const commentMatch = path.match(/^\/api\/comments\/([^/]+)$/);
      if (commentMatch && method === "DELETE") {
        requireUser();
        const { rows } = await db.query(
          "DELETE FROM comments WHERE id=$1 AND (user_id=$2 OR $3::boolean) RETURNING id",
          [commentMatch[1], user.id, user.role === "admin"],
        );
        if (!rows.length) throw httpError(404, "Комментарий не найден.");
        return send(200, { ok: true });
      }
      if (path.startsWith("/api/admin/")) {
        requireAdmin();
        if (path === "/api/admin/catalog" && method === "GET") {
          const articles = await db.query(
            `SELECT ${articleFields},a.content FROM articles a LEFT JOIN series s ON s.id=a.series_id ORDER BY a.date DESC,a.created_at DESC`,
            [user.id],
          );
          const series = await db.query("SELECT * FROM series ORDER BY title");
          const feedback = await db.query(
            "SELECT f.id,f.text,f.created_at AS date,u.name FROM feedback f JOIN users u ON u.id=f.user_id ORDER BY f.created_at DESC LIMIT 100",
          );
          return send(200, {
            articles: articles.rows.map(mapArticle),
            series: series.rows,
            feedback: feedback.rows,
          });
        }
        if (path === "/api/admin/series" && method === "POST") {
          const title = textField(body.title, "Название серии", 3, 120);
          const description = textField(
            body.description || "",
            "Описание",
            0,
            1000,
          );
          const id = randomUUID();
          await db.query(
            "INSERT INTO series (id,title,slug,description) VALUES ($1,$2,$3,$4)",
            [id, title, slugify(title), description],
          );
          return send(201, { id });
        }
        if (path === "/api/admin/articles" && method === "POST") {
          const data = validateArticle(body);
          const id = await insertArticle(
            db,
            data,
            `${slugify(data.title)}-${randomUUID().slice(0, 6)}`,
          );
          return send(201, { id });
        }
        const edit = path.match(/^\/api\/admin\/articles\/([^/]+)$/);
        if (edit && method === "PUT") {
          const data = validateArticle(body);
          const { rows } = await db.query(
            "UPDATE articles SET title=$2,excerpt=$3,cover=$4,content=$5,status=$6,date=$7,series_id=$8,episode=$9,source_url=$10,updated_at=NOW() WHERE id=$1 RETURNING id",
            [
              edit[1],
              data.title,
              data.excerpt,
              data.cover,
              data.content,
              data.status,
              data.date,
              data.seriesId,
              data.episode,
              data.sourceUrl,
            ],
          );
          if (!rows.length) throw httpError(404, "Статья не найдена.");
          return send(200, { id: rows[0].id });
        }
        if (edit && method === "DELETE") {
          const { rows } = await db.query(
            "DELETE FROM articles WHERE id=$1 RETURNING id",
            [edit[1]],
          );
          if (!rows.length) throw httpError(404, "Статья не найдена.");
          return send(200, { ok: true });
        }
        if (path === "/api/admin/import" && method === "POST") {
          if (
            !Array.isArray(body.articles) ||
            !body.articles.length ||
            body.articles.length > 100
          )
            throw httpError(400, "Загрузите от 1 до 100 статей.");
          const prepared = body.articles.map((article) => ({
            data: validateArticle(article, { imported: true }),
            slug: slugify(article.slug || article.title),
          }));
          const imported = await db.transaction(async (tx) => {
            let count = 0;
            for (const { data, slug } of prepared) {
              const existing = await tx.query(
                "SELECT id FROM articles WHERE slug=$1",
                [slug],
              );
              if (existing.rows.length) continue;
              await insertArticle(tx, data, slug);
              count++;
            }
            return count;
          });
          return send(201, { imported, skipped: prepared.length - imported });
        }
      }
      throw httpError(404, "Страница не найдена.");
    } catch (error) {
      if (error.code === "23505")
        return send(409, {
          error: "Логин, адрес статьи или номер части уже занят.",
        });
      if (error.code === "23503")
        return send(400, {
          error: "Выбранная серия или статья не существует.",
        });
      if (!error.status) logError("Archive API request failed:", error.message);
      return send(error.status || 503, {
        error:
          error.publicMessage ||
          "Сервис временно недоступен. Попробуйте позже.",
      });
    }
  };
}
