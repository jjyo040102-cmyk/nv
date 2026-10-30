import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptCredential, decryptCredential } from "../../lib/security/crypto";

describe("credential encryption", () => {
  const key = randomBytes(32);
  const raw = "sk-secret-example-1234567890";
  it("round trips using independent random nonces", () => {
    const first = encryptCredential(key, raw);
    const second = encryptCredential(key, raw);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(JSON.stringify(first)).not.toContain(raw);
    expect(decryptCredential(key, first)).toBe(raw);
  });
  it("rejects wrong keys and changed authenticated content", () => {
    const encrypted = encryptCredential(key, raw);
    expect(() => decryptCredential(randomBytes(32), encrypted)).toThrow();
    expect(() => decryptCredential(key, { ...encrypted, ciphertext: "AAAA" })).toThrow();
    expect(() => decryptCredential(key, { ...encrypted, tag: "AAAA" })).toThrow();
  });
  it("requires a 256-bit master key", () => {
    expect(() => encryptCredential(randomBytes(16), raw)).toThrow();
  });
  it("authenticates contextual session/provider data", () => {
    const encrypted = encryptCredential(key, raw, "session-one:openai");
    expect(decryptCredential(key, encrypted, "session-one:openai")).toBe(raw);
    expect(() => decryptCredential(key, encrypted, "session-two:openai")).toThrow();
    expect(() => decryptCredential(key, encrypted, "session-one:anthropic")).toThrow();
    expect(() => decryptCredential(key, encrypted)).toThrow();
  });
});
