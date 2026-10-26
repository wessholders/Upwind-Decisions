import assert from 'node:assert/strict';
import { it } from 'node:test';
import { format } from 'node:util';

export function closeTo(actual, expected, digits = 2) {
  assert.ok(Math.abs(actual - expected) < 0.5 * 10 ** -digits,
    `Expected ${actual} to be within ${0.5 * 10 ** -digits} of ${expected}`);
}

export function each(values, title, run, timeout = 20000) {
  for (const value of values) it(format(title, value), { timeout }, () => run(value));
}
