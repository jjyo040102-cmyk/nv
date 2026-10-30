import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
export function isSupportedNode(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  const [major, minor, patch] = version.split(".").map(Number);
  return (major === 22 && (minor > 22 || (minor === 22 && patch >= 2))) ||
    (major === 24 && minor >= 15) || major >= 26;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!isSupportedNode(process.versions.node)) {
    console.error("Install Node.js 24.15+ LTS (or 22.22.2+ on the 22.x branch) and run this launcher again."); process.exitCode = 1;
  } else console.log(`Node.js ${process.versions.node} ready.`);
}
