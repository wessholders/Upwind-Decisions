// Owned plain data only: no callbacks, class instances, cycles, or non-JSON numbers.
// Copy at ownership boundaries; observations assembled by the adapter can be
// frozen in place without copying their wind grid a second time.
export function freezeNpcData(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeNpcData(child);
    Object.freeze(value);
  }
  return value;
}

export function copyNpcData(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' ||
      (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))
    throw new Error('NPC data must contain only plain, finite JSON values.');
  if (ancestors.has(value)) throw new Error('NPC data cannot contain cycles.');
  ancestors.add(value);
  const result = Array.isArray(value) ? Array.from(value, child => copyNpcData(child, ancestors))
    : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copyNpcData(child, ancestors)]));
  ancestors.delete(value);
  return result;
}

export const immutableNpcData = value => freezeNpcData(copyNpcData(value));

export function isImmutableNpcData(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object' || !Object.isFrozen(value) ||
      (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return false;
  return Object.values(value).every(isImmutableNpcData);
}
