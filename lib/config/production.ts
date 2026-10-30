/** Fail before accepting traffic; deployment must never silently expose the shared demo identity. */
export function assertProductionConfig(env: Record<string,string|undefined>): void {
  if (env.NODE_ENV !== 'production') return;
  if (env.ACTFLOW_DEMO_AUTH !== 'false') throw new Error('Production requires ACTFLOW_DEMO_AUTH=false and an account created with auth:create-user.');
  if (env.ACTFLOW_TEST_MODE === 'true') throw new Error('Test fixtures cannot run in production.');
  if (!/^[a-f0-9]{64}$/i.test(env.ACTFLOW_MASTER_KEY ?? '')) throw new Error('Production requires a persistent 64-hex ACTFLOW_MASTER_KEY.');
  let url: URL;
  try { url = new URL(env.ACTFLOW_PUBLIC_URL ?? ''); } catch { throw new Error('Set ACTFLOW_PUBLIC_URL to the public HTTPS origin.'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw new Error('ACTFLOW_PUBLIC_URL must be an HTTPS origin (HTTP allowed only on loopback).');
}
