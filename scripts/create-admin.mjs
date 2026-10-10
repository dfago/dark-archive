import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { createDatabase } from "../server/database.js";
import { hashPassword, textField, passwordField } from "../server/security.js";
// No password in command arguments, repository, or logs.
let muted = false;
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) process.stdout.write(chunk);
    callback();
  },
});
const rl = createInterface({
  input: process.stdin,
  output,
  terminal: Boolean(process.stdin.isTTY),
});
let db;
try {
  const username = textField(
    await rl.question("Логин администратора: "),
    "Логин",
    3,
    40,
  ).toLowerCase();
  if (!/^[a-zа-яё0-9_.-]+$/i.test(username))
    throw new Error("Логин содержит недопустимые символы.");
  process.stdout.write("Пароль (минимум 10 символов, ввод скрыт): ");
  muted = true;
  const password = passwordField(await rl.question(""));
  muted = false;
  process.stdout.write("\n");
  db = await createDatabase();
  const existing = await db.query("SELECT id FROM users WHERE username=$1", [
    username,
  ]);
  if (existing.rows.length)
    throw new Error(
      "Этот логин уже занят. Выберите другой; существующий аккаунт не изменён.",
    );
  await db.query(
    "INSERT INTO users (id,username,name,password_hash,role) VALUES ($1,$2,$3,$4,'admin')",
    [randomUUID(), username, "Артём", await hashPassword(password)],
  );
  console.log("Аккаунт автора создан. Используйте обычный вход на сайте.");
} finally {
  rl.close();
  if (db) await db.close();
}
