/** Start the existing event/recovery loop even before the first browser/API request. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NODE_ENV === 'test' || process.env.NEXT_PHASE === 'phase-production-build') return;
  const { assertProductionConfig } = await import('./lib/config/production');
  assertProductionConfig(process.env);
  const { getRuntime } = await import('./lib/api/runtime');
  getRuntime();
}
