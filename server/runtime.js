import { createDatabase } from "./database.js";
import { createHandler } from "./app.js";
let database;
export async function getDatabase() {
  if (!database)
    database = createDatabase().catch((error) => {
      database = undefined;
      throw error;
    });
  return database;
}
export default createHandler({ getDatabase });
