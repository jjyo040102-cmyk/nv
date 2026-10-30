/** Deterministic defense-in-depth detector; never return credential fragments. */
export type SecretFinding = { type: string; index: number; preview: string };
const patterns: ReadonlyArray<readonly [string, RegExp]> = [
  ['PRIVATE_KEY', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g],
  ['OPENAI_KEY', /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ['GITHUB_TOKEN', /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/g],
  ['AWS_ACCESS_KEY', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['GOOGLE_KEY', /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ['BEARER_TOKEN', /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}={0,2}/gi],
  ['ENV_SECRET', /\b(?:[A-Z0-9_]*(?:API_?KEY|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY))\s*=\s*["']?([^\s#"']{8,})/gi],
  ['JSON_SECRET', /["'](?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password|passwd|authorization)["']\s*:\s*["']([^"'\r\n]{8,})["']/gi],
  ['CONNECTION_CREDENTIAL', /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis(?:s)?|amqps?):\/\/[^\s:@/]+:([^\s@/]+)@[^\s/]+/gi],
  ['OAUTH_TOKEN', /\bya29\.[A-Za-z0-9_-]{20,}\b/g],
];
function isPlaceholder(value: string): boolean {
  // Equality, not substring matching: a real key containing EXAMPLE must still block.
  return /^(?:REDACTED|CHANGEME|EXAMPLE|DUMMY|\*{4,}|<redacted>|<secret>|<token>|<api[_-]?key>)$/i.test(value);
}
export function scanSecrets(input: string | Buffer): SecretFinding[] {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : input;
  const output: SecretFinding[] = [];
  for (const [type, pattern] of patterns) {
    const re = new RegExp(pattern.source, pattern.flags);
    for (const match of text.matchAll(re)) {
      if (isPlaceholder(match[1] ?? match[0])) continue;
      output.push({ type, index: match.index!, preview: '[REDACTED]' });
      if (output.length >= 1000) return output;
    }
  }
  return output;
}
