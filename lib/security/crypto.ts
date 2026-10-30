import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedSecret = { ciphertext: string; iv: string; tag: string };
function assertKey(key: Uint8Array): void {
  if (key.byteLength !== 32) throw new Error("256비트 암호화 키가 필요합니다.");
}
export function encryptCredential(masterKey: Uint8Array, plaintext: string, context = ""): EncryptedSecret {
  assertKey(masterKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64url"), iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
}
export function decryptCredential(masterKey: Uint8Array, encrypted: EncryptedSecret, context = ""): string {
  assertKey(masterKey);
  try {
    const decipher = createDecipheriv("aes-256-gcm", masterKey, Buffer.from(encrypted.iv, "base64url"));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch { throw new Error("저장된 자격 증명을 복호화할 수 없습니다."); }
}
