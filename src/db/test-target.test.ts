import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTestTarget } from './test-target.ts';
const valid = 'postgresql://tester:secret@127.0.0.1:54342/frame_note_test';
test('accepts explicit isolated loopback target', () => assert.equal(assertTestTarget(valid, {}), valid));
for (const host of ['localhost', '[::1]']) {
  test(`accepts ${host}`, () => assert.equal(assertTestTarget(valid.replace('127.0.0.1', host), {}), valid.replace('127.0.0.1', host)));
}
for (const bad of [undefined, '', 'invalid', valid.replace('127.0.0.1', 'db.example.com'), valid.replace('frame_note_test', 'frame_note'), valid+'?host=example.com', valid+'#x', valid.replace(':54342', ''), valid.replace(':54342', ':0'), valid.replace('postgresql:', 'https:'), valid.replace('frame_note_test', 'other_test'), valid.replace('frame_note_test', 'frame_note_test/extra')]) {
  test(`rejects ambiguous target ${String(bad).replace('secret', 'redacted')}`, () => assert.throws(() => assertTestTarget(bad, {}), /test database/i));
}
for (const key of ['PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS']) {
  test(`rejects inherited ${key}`, () => assert.throws(() => assertTestTarget(valid, { [key]: 'override' }), /override/i));
}
test('errors never contain connection password', () => {
  assert.throws(() => assertTestTarget(valid.replace('127.0.0.1', 'remote'), {}), (error: unknown) => error instanceof Error && !error.message.includes('secret'));
});
