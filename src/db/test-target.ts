export function assertTestTarget(value: unknown, overrides: NodeJS.ProcessEnv = process.env): string {
  if (['PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS', 'PGUSER', 'PGUSERNAME', 'PGPASSWORD'].some(key => overrides[key])) {
    throw new Error('Remove PostgreSQL connection overrides before testing.');
  }
  try {
    if (typeof value !== 'string' || value.includes('?') || value.includes('#')) throw new Error();
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.port !== '54342'
      || !url.username || !url.password
      || url.pathname !== '/frame_note_test' || url.search || url.hash) throw new Error();
    return value;
  } catch {
    throw new Error('An explicit loopback test database URL for frame_note_test on port 54342 with no query/hash is required.');
  }
}
