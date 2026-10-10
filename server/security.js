import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password, hash) {
  const [algorithm, salt, key] = hash.split(":");
  if (algorithm !== "scrypt" || !salt || !key) return false;
  const computed = await scrypt(password, salt, 64);
  const saved = Buffer.from(key, "hex");
  return computed.length === saved.length && timingSafeEqual(computed, saved);
}
export function httpError(status, message) {
  return Object.assign(new Error(message), { status, publicMessage: message });
}
export function textField(value, label, min, max) {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.length > max
  )
    throw httpError(400, `${label}: от ${min} до ${max} символов.`);
  return value.trim();
}
export function passwordField(value) {
  if (typeof value !== "string" || value.length < 10 || value.length > 128)
    throw httpError(400, "Пароль: от 10 до 128 символов.");
  return value;
}
export function safeURL(value = "", { source = false } = {}) {
  if (value === "") return "";
  if (typeof value !== "string" || value.length > 2000)
    throw httpError(400, "Некорректная ссылка.");
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error();
    if (
      source &&
      !["dzen.ru", "www.dzen.ru", "zen.yandex.ru"].includes(url.hostname)
    )
      throw new Error();
    return url.href;
  } catch {
    throw httpError(
      400,
      source
        ? "Укажите HTTPS-ссылку на статью Дзена."
        : "Ссылка должна начинаться с https://.",
    );
  }
}
const transliteration = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};
export function slugify(text) {
  return (
    [...text.toLowerCase()]
      .map((c) => transliteration[c] ?? c)
      .join("")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "story"
  );
}
export async function createSession(db, userId, response, secure) {
  const token = randomBytes(32).toString("hex");
  await db.query("DELETE FROM sessions WHERE expires_at < NOW()");
  await db.query(
    "INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ($1,$2,NOW()+INTERVAL '30 days')",
    [digest(token), userId],
  );
  response.setHeader(
    "Set-Cookie",
    `archive_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure ? "; Secure" : ""}`,
  );
}
export function sessionToken(request) {
  return (
    request.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("archive_session="))
      ?.slice("archive_session=".length) || ""
  );
}
export async function currentUser(db, request) {
  const token = sessionToken(request);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const { rows } = await db.query(
    "SELECT u.id,u.username,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW()",
    [digest(token)],
  );
  return rows[0] || null;
}
export function checkMutation(request, siteURL) {
  if (request.headers["x-archive-request"] !== "1")
    throw httpError(403, "Обновите страницу и повторите действие.");
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw httpError(415, "Ожидается JSON.");
  const origin = request.headers.origin;
  const host = request.headers.host;
  const allowed = siteURL
    ? new URL(siteURL).origin
    : `${process.env.VERCEL || process.env.NODE_ENV === "production" ? "https" : "http"}://${host}`;
  if (origin && origin !== allowed)
    throw httpError(403, "Этот запрос нельзя выполнить с другого сайта.");
}
export async function rateLimit(db, key, limit, seconds) {
  const { rows } = await db.query(
    `INSERT INTO rate_limits (key,count,reset_at) VALUES ($1,1,NOW()+$2*INTERVAL '1 second') ON CONFLICT (key) DO UPDATE SET count=CASE WHEN rate_limits.reset_at<NOW() THEN 1 ELSE rate_limits.count+1 END, reset_at=CASE WHEN rate_limits.reset_at<NOW() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END RETURNING count`,
    [digest(key), seconds],
  );
  if (rows[0].count > limit)
    throw httpError(429, "Слишком много попыток. Попробуйте позже.");
}
