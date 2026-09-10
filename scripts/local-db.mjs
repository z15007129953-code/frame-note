import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = path.join(root, '.local');
const bin = process.env.FRAME_POSTGRES_BIN;
const mode = process.argv[2];
const clusters = [
  { name: 'development', port: 54341, database: 'frame_note' },
  { name: 'test', port: 54342, database: 'frame_note_test' },
];
function run(command, args, extra = {}) {
  const result = spawnSync(path.join(bin, command), args, {
    cwd: root, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, ...extra,
  });
  if (result.status !== 0) throw new Error(`${command} failed; inspect this project's local database logs.`);
  return result.stdout;
}
function dataPath(cluster) { return path.join(local, `postgres-${cluster.name}`); }
function validate(cluster) {
  const data = dataPath(cluster);
  const marker = JSON.parse(readFileSync(path.join(data, 'frame-note-cluster.json'), 'utf8'));
  if (marker.database !== cluster.database || marker.port !== cluster.port || marker.data !== data
    || readFileSync(path.join(data, 'PG_VERSION'), 'utf8').trim() !== '17') throw new Error('Cluster identity mismatch.');
  return data;
}
function start(cluster) {
  const data = validate(cluster);
  if (spawnSync(path.join(bin, 'pg_ctl'), ['-D', data, 'status'], { stdio: 'ignore' }).status === 0) return;
  run('pg_ctl', ['-D', data, '-l', path.join(local, `${cluster.name}.log`), '-o', `-h 127.0.0.1 -p ${cluster.port} -k ''`, '-w', 'start']);
}
try {
  if (!bin || !path.isAbsolute(bin) || !existsSync(path.join(bin, 'pg_ctl'))) throw new Error('Set FRAME_POSTGRES_BIN to the absolute PostgreSQL 17 bin directory.');
  if (!['init', 'start', 'stop'].includes(mode)) throw new Error('Usage: npm run db:local -- init|start|stop');
  for (const key of ['PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGSERVICE','PGSERVICEFILE','PGOPTIONS','PGUSER','PGUSERNAME','PGPASSWORD']) {
    if (process.env[key]) throw new Error('Remove inherited PostgreSQL connection overrides.');
  }
  if (mode === 'init') {
    if (existsSync(path.join(root, '.env.local')) || clusters.some(c => existsSync(dataPath(c)))) throw new Error('Existing database/configuration found; nothing overwritten.');
    if (!run('postgres', ['--version']).includes(' 17.')) throw new Error('PostgreSQL 17 is required.');
    mkdirSync(local, { recursive: true, mode: 0o700 });
    const password = randomBytes(32).toString('hex');
    const passwordFile = path.join(local, 'initial-password');
    writeFileSync(passwordFile, password, { mode: 0o600, flag: 'wx' });
    try {
      for (const cluster of clusters) {
        const data = dataPath(cluster);
        run('initdb', ['-D', data, '-U', 'frame_local', '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C', `--pwfile=${passwordFile}`]);
        writeFileSync(path.join(data, 'frame-note-cluster.json'), JSON.stringify({ ...cluster, data }), { mode: 0o600, flag: 'wx' });
        start(cluster);
        run('createdb', ['-h','127.0.0.1','-p',String(cluster.port),'-U','frame_local',cluster.database], { env: { ...process.env, LC_ALL: 'C', PGPASSWORD: password } });
      }
      writeFileSync(path.join(root, '.env.local'), clusters.map(c => `${c.name === 'test' ? 'TEST_DATABASE_URL' : 'DATABASE_URL'}=postgresql://frame_local:${password}@127.0.0.1:${c.port}/${c.database}`).join('\n')+'\n', { mode: 0o600, flag: 'wx' });
    } finally { unlinkSync(passwordFile); }
  } else if (mode === 'start') {
    for (const cluster of clusters) start(cluster);
  } else {
    for (const cluster of clusters) {
      const data = validate(cluster);
      if (spawnSync(path.join(bin, 'pg_ctl'), ['-D', data, 'status'], { stdio: 'ignore' }).status === 0) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    }
  }
  console.log(`Frame Note local database ${mode} completed. No other project was modified.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Local database operation failed.');
  process.exitCode = 1;
}
