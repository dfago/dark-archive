export async function api(
  path,
  { method = "GET", body, signal, keepalive = false } = {},
) {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    signal,
    keepalive,
    headers:
      method === "GET"
        ? {}
        : { "Content-Type": "application/json", "X-Archive-Request": "1" },
    ...(method === "GET" ? {} : { body: JSON.stringify(body || {}) }),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Не удалось связаться с архивом. Попробуйте позже.");
  }
  if (!response.ok)
    throw Object.assign(
      new Error(data.error || "Не удалось выполнить действие."),
      { status: response.status },
    );
  return data;
}
export function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
export function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Private browsing/quota: reading still works. */
  }
}
export function guestProgress(id) {
  const saved = readLocal(`archive:progress:${id}`, null);
  return saved &&
    Number.isInteger(saved.paragraph) &&
    Number.isInteger(saved.percent)
    ? saved
    : null;
}
export function formatDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";
}
export function downloadJSON(name, data) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
