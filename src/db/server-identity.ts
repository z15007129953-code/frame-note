import { isIP } from 'node:net';

type ServerIdentity = { name: unknown; address: unknown; port: unknown };
type ResolvedTarget = { host: readonly string[]; port: readonly number[]; database: string };

/** Only use after assertTestTarget validates the explicit URL and environment. */
export function assertResolvedTestTarget(guardedUrl: string, options: ResolvedTarget): void {
  const url = new URL(guardedUrl);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (options.host.length !== 1 || options.host[0] !== host
    || options.port.length !== 1 || options.port[0] !== Number(url.port)
    || options.database !== url.pathname.slice(1)) {
    throw new Error('Resolved PostgreSQL destination differs from the guarded test URL.');
  }
}

export function assertServerIdentity(identity: ServerIdentity, transport?: string): void {
  if (transport !== undefined && transport !== 'native' && transport !== 'docker') throw new Error('Unknown test transport.');
  const address = identity.address;
  let valid = false;
  if (transport === 'docker' && typeof address === 'string' && isIP(address) === 4) {
    const [first, second] = address.split('.').map(Number);
    const privateAddress = first === 10 || (first === 172 && second! >= 16 && second! <= 31) || (first === 192 && second === 168);
    valid = privateAddress && identity.port === 5432;
  } else if (transport !== 'docker') {
    valid = (address === '127.0.0.1' || address === '::1') && identity.port === 54342;
  }
  if (identity.name !== 'frame_note_test' || !valid) throw new Error('Connected PostgreSQL server is not the expected isolated test database.');
}
