import { spawn } from "node:child_process";
const url = process.argv[2] ?? "http://127.0.0.1:3000";
const target = new URL(url);
if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || target.protocol !== "http:") throw new Error("Only a local ActFlow URL may be opened");
const deadline = Date.now() + 90_000;
let ready = false;
while (Date.now() < deadline) {
  try { const response = await fetch(new URL("/api/session/actor", target), { signal: AbortSignal.timeout(1500) }); const result = await response.json(); if (response.ok && result.actor?.sessionId === "actflow-local-demo") { ready = true; break; } } catch { /* Server is still starting. */ }
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (!ready) { console.error("ActFlow did not become ready. Check the launcher terminal."); process.exitCode = 1; }
else {
  const command = process.platform === "win32" ? "cmd.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/d", "/c", "start", '""', url] : [url];
  const child = spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true });
  child.on("error", () => console.error(`Open ${url} in your browser.`)); child.unref();
}
