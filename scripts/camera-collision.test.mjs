import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCameraPosition } from '../src/camera-collision.js';

const origin = { x: 0, y: 1.3, z: 0 };
const desired = { x: 0, y: 1.3, z: 7 };
const wall = (near, far) => ({ min: { x: -2, y: 0, z: near }, max: { x: 2, y: 4, z: far } });
const close = (actual, expected) => assert(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('unblocked segment preserves full third person position without mutation', () => {
  const before = structuredClone({ origin, desired });
  assert.deepEqual(resolveCameraPosition(origin, desired, []), desired);
  assert.deepEqual({ origin, desired }, before);
  assert.notEqual(resolveCameraPosition(origin, desired, []), desired);
});
test('wall clips camera just before expanded front face', () => {
  const result = resolveCameraPosition(origin, desired, [wall(3.5, 4)]);
  close(result.z, 3.299);
  close(result.y, origin.y);
  assert.equal(result.x, 0);
});
test('parallel segment outside a slab remains unobstructed', () => {
  const box = { min: { x: 2, y: 0, z: 2 }, max: { x: 3, y: 4, z: 4 } };
  assert.deepEqual(resolveCameraPosition(origin, desired, [box]), desired);
});
test('nearest obstacle wins regardless of box ordering', () => {
  for (const boxes of [[wall(5, 6), wall(2, 3)], [wall(2, 3), wall(5, 6)]]) {
    close(resolveCameraPosition(origin, desired, boxes).z, 1.799);
  }
});
test('starting inside a box is ignored but another wall still clips', () => {
  const enclosing = wall(-1, 1);
  const result = resolveCameraPosition(origin, desired, [enclosing, wall(4, 5)]);
  assert(Object.values(result).every(Number.isFinite));
  close(result.z, 3.799);
  assert.deepEqual(resolveCameraPosition(origin, desired, [enclosing]), desired);
});
test('grazing an obstacle boundary counts as obstruction', () => {
  const box = { min: { x: 0, y: 0, z: 3 }, max: { x: 2, y: 4, z: 4 } };
  close(resolveCameraPosition(origin, desired, [box], 0).z, 2.999);
});
test('diagonal segment preserves its direction when shortened', () => {
  const end = { x: 6, y: 7.3, z: 6 };
  const box = { min: { x: 3, y: 0, z: 3 }, max: { x: 4, y: 10, z: 4 } };
  const result = resolveCameraPosition(origin, end, [box], 0);
  close(result.x, result.z);
  close(result.y - origin.y, result.z);
  assert(result.z < 3 && result.z > 2.99);
});
test('zero length segment remains finite even inside an obstacle', () => {
  assert.deepEqual(resolveCameraPosition(origin, origin, [wall(-1, 1)]), origin);
});
test('negative direction ray and obstacles behind target are handled', () => {
  const end = { x: 0, y: 1.3, z: -7 };
  close(resolveCameraPosition(origin, end, [wall(-4, -3)]).z, -2.799);
  assert.deepEqual(resolveCameraPosition(origin, desired, [wall(-4, -3)]), desired);
});
test('target on expanded boundary can escape and endpoint touch clips', () => {
  assert.deepEqual(resolveCameraPosition(origin, desired, [wall(.2, 1)]), desired);
  close(resolveCameraPosition(origin, desired, [wall(7, 8)], 0).z, 6.999);
});
test('near wall takes priority over any minimum orbit distance', () => {
  const result = resolveCameraPosition(origin, desired, [wall(.25, 1)]);
  close(result.z, .049);
});
