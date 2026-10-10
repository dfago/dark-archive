import { createDatabase } from "../server/database.js";
const db = await createDatabase();
console.log("Миграции применены.");
await db.close();
