import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import JSZip from "jszip";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "data/runtime/submission/ActFlow-Nebius-NVIDIA-Review-Source.zip");
const folders = ["app", "components", "lib", "scripts", "tests", "data/demo", "deploy"];
const files = [".env.example", ".gitattributes", ".gitignore", ".dockerignore", "Dockerfile", "LICENSE", "AGENTS.md", "instrumentation.ts", "proxy.ts", "next.config.ts", "package.json", "package-lock.json", "playwright.config.ts", "README.md", "start.bat", "start.sh", "tsconfig.json", "vitest.config.ts", "docs/PROVIDERS.md", "docs/SECURITY.md", "docs/COMPETITION_DEMO.md", "docs/DEPLOYMENT.md"];
const archive = new JSZip();
const entries = [];
const insideRoot = path => {
  const part = relative(root, path);
  if (!part || part === ".." || part.startsWith(`..${sep}`) || isAbsolute(part)) throw new Error("Packaging path escapes the project");
  return part.replaceAll("\\", "/");
};
const addFile = async path => {
  const name = insideRoot(path);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Packaging requires a regular file: ${name}`);
  if ((/(?:^|\/)\.env(?:\.|$)/.test(name) && name !== ".env.example") || /(?:^|\/)(?:node_modules|\.next|history|runtime|test-results|playwright-report)(?:\/|$)/.test(name) || /\.(?:sqlite(?:-wal|-shm)?|traineddata(?:\.gz)?)$/.test(name)) throw new Error(`Private/runtime file cannot be packaged: ${name}`);
  archive.file(name, await readFile(path));
  entries.push(name);
};
const addFolder = async path => {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Packaging requires a real source directory");
  for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = resolve(path, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Source package cannot follow symbolic links");
    if (entry.isDirectory()) await addFolder(child); else await addFile(child);
  }
};
for (const folder of folders) await addFolder(resolve(root, folder));
for (const file of files) await addFile(resolve(root, file));
for (const entry of await readdir(resolve(root, "docs/hackathon"))) {
  if (entry.endsWith(".md") || entry === "verification-results.json") await addFile(resolve(root, "docs/hackathon", entry));
}
await mkdir(dirname(output), { recursive: true });
insideRoot(output);
await writeFile(output, await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }));
const inspected = await JSZip.loadAsync(await readFile(output));
if (Object.values(inspected.files).filter(entry => !entry.dir).length !== entries.length) throw new Error("Source package entry verification failed");
console.log(`Review source: ${relative(root, output).replaceAll("\\", "/")} (${entries.length} source files).`);
console.log("Live account verification, judge access, deployment and publication remain separate submission steps.");
