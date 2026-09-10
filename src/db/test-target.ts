export function assertTestTarget(value: unknown, overrides: NodeJS.ProcessEnv = process.env): string {
  if (['PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS'].some(key => overrides[key])) {
    throw new Error('Remove PostgreSQL connection overrides before testing.');
  }
  try {
    if (typeof value !== 'string') throw new Error();
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || !url.port || Number(url.port) < 1 || Number(url.port) > 65535
      || url.pathname !== '/frame_note_test' || url.search || url.hash) throw new Error();
    return value;
  } catch {
    throw new Error('An explicit loopback test database URL for frame_note_test with a port and no query/hash is required.');
  }
}
