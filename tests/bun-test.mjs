import {
  describe as nDescribe,
  test as nTest,
  before as nBefore,
  after as nAfter,
  beforeEach as nBeforeEach,
  afterEach as nAfterEach,
} from "node:test";
import assert from "node:assert";

export const describe = nDescribe;
export const it = nTest;
export const test = nTest;
export const beforeAll = nBefore;
export const afterAll = nAfter;
export const beforeEach = nBeforeEach;
export const afterEach = nAfterEach;

export function expect(actual) {
  const createMatchers = (isNot = false) => ({
    toBe(expected) {
      if (isNot) assert.notStrictEqual(actual, expected);
      else assert.strictEqual(actual, expected);
    },
    toEqual(expected) {
      if (isNot) assert.notDeepStrictEqual(actual, expected);
      else assert.deepStrictEqual(actual, expected);
    },
    toBeTrue() {
      if (isNot) assert.notStrictEqual(actual, true);
      else assert.strictEqual(actual, true);
    },
    toBeFalse() {
      if (isNot) assert.notStrictEqual(actual, false);
      else assert.strictEqual(actual, false);
    },
    toBeGreaterThan(expected) {
      if (isNot) assert.ok(actual <= expected);
      else assert.ok(actual > expected, `expected ${actual} > ${expected}`);
    },
    toBeGreaterThanOrEqual(expected) {
      if (isNot) assert.ok(actual < expected);
      else assert.ok(actual >= expected, `expected ${actual} >= ${expected}`);
    },
    toBeLessThan(expected) {
      if (isNot) assert.ok(actual >= expected);
      else assert.ok(actual < expected, `expected ${actual} < ${expected}`);
    },
    toBeLessThanOrEqual(expected) {
      if (isNot) assert.ok(actual > expected);
      else assert.ok(actual <= expected, `expected ${actual} <= ${expected}`);
    },
    toContain(expected) {
      if (typeof actual === "string" || Array.isArray(actual)) {
        if (isNot) assert.ok(!actual.includes(expected));
        else assert.ok(actual.includes(expected), `expected collection to contain ${expected}`);
      } else if (actual instanceof Set || actual instanceof Map) {
        if (isNot) assert.ok(!actual.has(expected));
        else assert.ok(actual.has(expected));
      }
    },
    toMatch(expected) {
      const reg = typeof expected === "string" ? new RegExp(expected) : expected;
      if (isNot) assert.ok(!reg.test(String(actual)));
      else assert.ok(reg.test(String(actual)), `expected ${actual} to match ${expected}`);
    },
    toThrow(expected) {
      if (isNot) assert.doesNotThrow(actual, expected);
      else assert.throws(actual, expected);
    },
    toBeDefined() {
      if (isNot) assert.strictEqual(actual, undefined);
      else assert.notStrictEqual(actual, undefined);
    },
    toBeUndefined() {
      if (isNot) assert.notStrictEqual(actual, undefined);
      else assert.strictEqual(actual, undefined);
    },
    toBeNull() {
      if (isNot) assert.notStrictEqual(actual, null);
      else assert.strictEqual(actual, null);
    },
    get not() {
      return createMatchers(!isNot);
    },
  });

  return createMatchers(false);
}
