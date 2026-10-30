import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
export async function initializeLocalEnv(directory = process.cwd()) {
  await mkdir(directory, { recursive: true });
  const content = ["ACTFLOW_DATA_DIR=./data/runtime", "ACTFLOW_DB_PATH=./data/runtime/actflow.sqlite", "ACTFLOW_DEMO_AUTH=true", "ACTFLOW_MAX_UPLOAD_MB=25",
    `ACTFLOW_MASTER_KEY=${randomBytes(32).toString("hex")}`, `ACTFLOW_SESSION_SECRET=${randomBytes(32).toString("hex")}`, ""].join("\n");
  try { await writeFile(resolve(directory, ".env.local"), content, { flag: "wx", mode: 0o600 }); return true; }
  catch (error) { if (error.code === "EEXIST") return false; throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const created = await initializeLocalEnv();
  console.log(created ? "Created private .env.local with encryption and session keys." : "Kept existing .env.local.");
}
