import assert from 'node:assert/strict';
import { test } from 'node:test';
import postgres from 'postgres';

import { assertServerIdentity, assertResolvedTestTarget } from './server-identity.ts';
const url = 'postgresql://tester:private@127.0.0.1:54342/frame_note_test';

test('native server identity requires exact loopback address, database and internal port', () => {
  for (const address of ['127.0.0.1', '::1']) assert.doesNotThrow(() => assertServerIdentity({ name: 'frame_note_test', address, port: 54342 }));
  for (const identity of [
    { name: 'frame_note', address: '127.0.0.1', port: 54342 },
    { name: 'frame_note_test', address: '127.0.0.1', port: 5432 },
    { name: 'frame_note_test', address: '172.18.0.2', port: 54342 },
    { name: 'frame_note_test', address: null, port: 54342 },
  ]) assert.throws(() => assertServerIdentity(identity));
});
test('Docker bridge identity is accepted only through explicit Docker opt-in', () => {
  for (const address of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.2']) {
    const identity = { name: 'frame_note_test', address, port: 5432 };
    assert.throws(() => assertServerIdentity(identity));
    assert.doesNotThrow(() => assertServerIdentity(identity, 'docker'));
  }
  for (const address of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '169.254.1.1', '127.0.0.1', '10.999.0.1', 'fd00::1']) {
    assert.throws(() => assertServerIdentity({ name: 'frame_note_test', address, port: 5432 }, 'docker'));
  }
  assert.throws(() => assertServerIdentity({ name: 'frame_note_test', address: '172.18.0.2', port: 54342 }, 'docker'));
  assert.throws(() => assertServerIdentity({ name: 'frame_note', address: '172.18.0.2', port: 5432 }, 'docker'));
  assert.throws(() => assertServerIdentity({ name: 'frame_note_test', address: '127.0.0.1', port: 54342 }, 'anything'));
});
test('resolved driver destination must match already guarded URL before connecting', async () => {
  for (const hostname of ['127.0.0.1', 'localhost']) {
    const value = url.replace('127.0.0.1', hostname);
    const client = postgres(value);
    try { assert.doesNotThrow(() => assertResolvedTestTarget(value, client.options)); }
    finally { await client.end(); }
  }
  const ipv6 = url.replace('127.0.0.1', '[::1]');
  assert.doesNotThrow(() => assertResolvedTestTarget(ipv6, { host: ['::1'], port: [54342], database: 'frame_note_test' }));
  // postgres 3.4.9 misparses bracketed IPv6 URLs; the policy must fail closed.
  const brokenIpv6 = postgres(ipv6);
  try { assert.throws(() => assertResolvedTestTarget(ipv6, brokenIpv6.options)); }
  finally { await brokenIpv6.end(); }
  const client = postgres(url);
  try {
    for (const changed of [{ host: ['remote.example'] }, { port: [5432] }, { database: 'frame_note' }, { host: ['127.0.0.1', 'remote.example'] }]) {
      assert.throws(() => assertResolvedTestTarget(url, { ...client.options, ...changed }));
    }
  } finally { await client.end(); }
});
