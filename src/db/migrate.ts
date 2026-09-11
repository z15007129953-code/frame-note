import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Connection } from './connection.ts';

export type Migration = { name: string; sql: string };
/** Optional explicit migrations support testing transactional failure without changing applied files. */
export async function migrate(connection: Connection, migrations?: readonly Migration[]): Promise<void> {
  const entries = migrations ?? await Promise.all(['0000_review.sql', '0001_demo_sessions.sql', '0002_comments.sql'].map(async name => ({
    name, sql: await readFile(new URL(`../../drizzle/${name}`, import.meta.url), 'utf8'),
  })));
  if (new Set(entries.map(entry => entry.name)).size !== entries.length) throw new Error('Duplicate migration name');
  await connection.sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(1734823901, 1)`;
    await tx`create table if not exists frame_note_migrations (name text primary key, checksum text not null, applied_at timestamptz not null default current_timestamp)`;
    for (const entry of entries) {
      const checksum = createHash('sha256').update(entry.sql).digest('hex');
      const prior = await tx`select checksum from frame_note_migrations where name = ${entry.name}`;
      if (prior.length) {
        if (prior[0]!.checksum !== checksum) throw new Error(`Applied migration checksum mismatch: ${entry.name}`);
        continue;
      }
      await tx.unsafe(entry.sql).simple();
      await tx`insert into frame_note_migrations (name, checksum) values (${entry.name}, ${checksum})`;
    }
  });
}
