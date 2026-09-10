import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.ts';

/** Caller supplies the URL and owns shutdown via connection.sql.end(). */
export function createConnection(url: string) {
  const sql = postgres(url, { max: 5, onnotice: () => {} });
  return { sql, db: drizzle(sql, { schema }) };
}
export type Connection = ReturnType<typeof createConnection>;
