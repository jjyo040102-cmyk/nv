import { createRequire } from "node:module";
import { expect, it } from "vitest";
it("uses the patched UUID dependency behind ExcelJS", () => {
  const require = createRequire(import.meta.url);
  const excelRequire = createRequire(require.resolve("exceljs"));
  const uuid = excelRequire("uuid") as { v5: (name: string, namespace: string, buffer: Uint8Array, offset: number) => unknown };
  expect(() => uuid.v5("actflow", "6ba7b810-9dad-11d1-80b4-00c04fd430c8", new Uint8Array(8), 4)).toThrow(RangeError);
});
