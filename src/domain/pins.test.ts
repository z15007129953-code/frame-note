import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePin, projectPin, isValidPin } from './pins.ts';

const image = { left: 50, top: 50, width: 200, height: 100 };
test('normalizes against image bounds, not the surrounding stage', () => {
  assert.deepEqual(normalizePin({ x: 150, y: 100 }, image), { x: 0.5, y: 0.5 });
});
test('projects stored coordinates after resizing', () => {
  assert.deepEqual(projectPin({ x: 0.5, y: 0.5 }, { left: 0, top: 0, width: 800, height: 400 }), { x: 400, y: 200 });
});
for (const [point, pin] of [
  [{ x: 50, y: 50 }, { x: 0, y: 0 }],
  [{ x: 250, y: 50 }, { x: 1, y: 0 }],
  [{ x: 50, y: 150 }, { x: 0, y: 1 }],
  [{ x: 250, y: 150 }, { x: 1, y: 1 }],
]) {
  test(`accepts image corner ${pin.x},${pin.y}`, () => {
    assert.deepEqual(normalizePin(point, image), pin);
    assert.deepEqual(projectPin(pin, image), point);
  });
}
for (const point of [{ x: 49.999, y: 100 }, { x: 250.001, y: 100 }, { x: 100, y: 49.999 }, { x: 100, y: 150.001 }]) {
  test(`rejects letterbox/outside click ${point.x},${point.y}`, () => assert.equal(normalizePin(point, image), null));
}
for (const value of [null, undefined, [], {}, { x: 0 }, { x: '0', y: 0 }, { x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: -0.1, y: 0 }, { x: 1.1, y: 0 }, { x: 0, y: -0.1 }, { x: 0, y: 1.1 }]) {
  test(`rejects invalid pin ${JSON.stringify(value)}`, () => {
    assert.equal(isValidPin(value), false);
    assert.equal(projectPin(value as never, image), null);
  });
}
for (const value of [null, undefined, [], {}, { x: '150', y: 100 }, { x: NaN, y: 100 }, { x: 150, y: Infinity }]) {
  test(`rejects invalid pointer ${JSON.stringify(value)}`, () => assert.equal(normalizePin(value as never, image), null));
}
for (const rect of [null, undefined, [], {}, { ...image, width: 0 }, { ...image, height: -1 }, { ...image, width: Infinity }, { ...image, top: NaN }, { ...image, left: '50' }, { ...image, height: undefined }, { ...image, left: Number.MAX_VALUE, width: Number.MAX_VALUE }]) {
  test(`rejects invalid image rectangle ${JSON.stringify(rect)}`, () => {
    assert.equal(normalizePin({ x: 150, y: 100 }, rect as never), null);
    assert.equal(projectPin({ x: 0.5, y: 0.5 }, rect as never), null);
  });
}
test('roundtrip retains fractional coordinates', () => {
  const rect = { left: -120, top: 17.5, width: 813.3, height: 299.2 };
  const pin = { x: 0.237, y: 0.813 };
  const point = projectPin(pin, rect);
  assert.ok(point);
  const normalized = normalizePin(point, rect);
  assert.ok(normalized);
  assert.ok(Math.abs(normalized.x - pin.x) < 1e-12);
  assert.ok(Math.abs(normalized.y - pin.y) < 1e-12);
});
test('validates both inclusive edges', () => {
  assert.equal(isValidPin({ x: 0, y: 1 }), true);
  assert.equal(isValidPin({ x: 1, y: 0 }), true);
});
test('accepts fractional far edges without floating-point drift', () => {
  const rect = { left: 0.1, top: 0.1, width: 0.2, height: 0.2 };
  assert.deepEqual(normalizePin({ x: rect.left + rect.width, y: rect.top + rect.height }, rect), { x: 1, y: 1 });
});
test('does not mutate frozen inputs', () => {
  const pin = Object.freeze({ x: 0.5, y: 0.5 });
  const rect = Object.freeze(image);
  assert.deepEqual(projectPin(pin, rect), { x: 150, y: 100 });
  assert.deepEqual(normalizePin(Object.freeze({ x: 150, y: 100 }), rect), pin);
});
