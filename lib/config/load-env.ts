import { existsSync } from "node:fs";
// CLI scripts share Next's local configuration; process environment takes priority.
if (process.env.NODE_ENV === 'production' && existsSync('.env.production.local')) process.loadEnvFile('.env.production.local');
else if (existsSync(".env.local")) process.loadEnvFile(".env.local");
else if (existsSync(".env")) process.loadEnvFile(".env");
