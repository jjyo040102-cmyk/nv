import "../lib/config/load-env";
import { readConfig } from "../lib/config";
import { openDatabase } from "../lib/db";
import { runMigrations } from "../lib/db/migrate";
import { AccountService } from "../lib/auth/accounts";
// Supply the password via stdin or a private process environment, never a command-line argument.
const args = process.argv.slice(2), option = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const username = option("--username"), role = option("--role") ?? "APPROVER", workspaceId = option("--workspace");
if (!username || !["USER", "APPROVER"].includes(role)) throw new Error("Usage: npm run auth:create-user -- --username USER [--role USER|APPROVER] [--workspace ID]. Supply ACTFLOW_NEW_USER_PASSWORD or stdin.");
let password = process.env.ACTFLOW_NEW_USER_PASSWORD;
if (!password && !process.stdin.isTTY) { const chunks: Buffer[] = []; for await (const chunk of process.stdin) { chunks.push(Buffer.from(chunk)); if (Buffer.concat(chunks).length > 1024) throw new Error("Password input too long"); } password = Buffer.concat(chunks).toString("utf8").trimEnd(); }
if (!password) throw new Error("Set ACTFLOW_NEW_USER_PASSWORD in this process or provide password through stdin.");
const db = openDatabase(readConfig(process.env)); runMigrations(db);
try { const result = await new AccountService(db).create({ username, password, role: role as "USER" | "APPROVER", workspaceId }); console.log(`Created ${username} (${role}) in workspace ${result.workspaceId}. Password was not logged.`); }
finally { db.close(); }
