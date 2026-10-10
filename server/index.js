import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import handler, { getDatabase } from "./runtime.js";
const root = resolve("dist");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};
const server = createServer(async (request, response) => {
  if (request.url.startsWith("/api/")) return handler(request, response);
  if (request.url === "/sitemap.xml" || request.url === "/robots.txt") {
    request.url =
      request.url === "/sitemap.xml" ? "/api/sitemap" : "/api/robots";
    return handler(request, response);
  }
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    let file = resolve(root, "." + pathname);
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    if (pathname === "/") file = resolve(root, "index.html");
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error();
    } catch {
      if (extname(pathname)) {
        response.writeHead(404).end();
        return;
      }
      file = resolve(root, "index.html");
    }
    response.setHeader(
      "Content-Type",
      mime[extname(file)] || "application/octet-stream",
    );
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end("Запустите npm run build для сборки сайта.");
  }
});
await getDatabase();
server.listen(Number(process.env.PORT || 3001), "0.0.0.0", () =>
  console.log(`Тёмный архив: http://localhost:${process.env.PORT || 3001}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(async () => {
      await (await getDatabase()).close();
      process.exit(0);
    }),
  );
