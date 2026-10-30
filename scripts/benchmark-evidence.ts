// Deliberately does not load .env or instantiate a network provider.
import { resolve } from "node:path";
import { writeEvidenceSuite } from "../lib/benchmark/evidence";

if (process.env.NODE_ENV === "production") throw new Error("Run offline evidence outside production");
process.env.ACTFLOW_TEST_MODE = "true";
const args = process.argv.slice(2);
if (args.some((arg, index) => arg !== "--output" && args[index - 1] !== "--output")) throw new Error("Usage: benchmark-evidence.ts [--output directory]");
const index = args.indexOf("--output");
if (index >= 0 && !args[index + 1]) throw new Error("--output requires a directory");
const result = await writeEvidenceSuite(index < 0 ? undefined : resolve(args[index + 1]));
console.log(`Offline fixture evidence: ${result.report.summary.passed}/${result.report.distinctCases} passed; model calls=0, external sends=0.\nReport: ${result.markdown}\nRaw evidence: ${result.json}`);
if (result.report.summary.failed) process.exitCode = 1;
