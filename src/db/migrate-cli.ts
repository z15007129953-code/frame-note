import { createConnection, type Connection } from './connection.ts';
import { migrate } from './migrate.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required. Configure .env.local first.');
  process.exitCode = 1;
} else {
  let connection: Connection | undefined;
  try {
    connection = createConnection(url);
    await migrate(connection);
    console.log('Frame Note database migrations are current.');
  } catch {
    console.error('Migration failed. Check local database availability and migration checksums.');
    process.exitCode = 1;
  } finally {
    if (connection) await connection.sql.end();
  }
}
