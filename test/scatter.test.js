import { describe, it, expect } from 'vitest';
import seedrandom from 'seedrandom';
import { LEVEL_MAP, parseLevel, isWalkable } from '../src/level/level.js';
import { findPath } from '../src/level/pathfinding.js';
import {
  scatterItems,
  KEY_COUNT,
  KEY_SPACING,
  KEY_MIN_WALK,
  THROWABLE_COUNT,
  STARTER_WALK,
} from '../src/level/scatter.js';

const level = parseLevel(LEVEL_MAP);
const SEEDS = Array.from({ length: 25 }, (_, i) => `run-${i}`);
const walk = (cell) => findPath(level, level.spawn, cell)?.length ?? Infinity;
const sameCell = (a, b) => a.x === b.x && a.z === b.z;

describe('scatterItems', () => {
  it('places every key on plain floor the player can walk to, away from the spawn and from each other', () => {
    for (const seed of SEEDS) {
      const { keys } = scatterItems(level, seedrandom(seed));
      expect(keys).toHaveLength(KEY_COUNT);
      keys.forEach((key, i) => {
        expect(isWalkable(level, key.x, key.z)).toBe(true);
        expect(['.', 'L']).toContain(level.tiles[key.z][key.x]); // not in a locker, vent or on a battery
        expect(walk(key)).toBeGreaterThanOrEqual(KEY_MIN_WALK);
        keys.slice(i + 1).forEach((other) => {
          expect(Math.hypot(key.x - other.x, key.z - other.z)).toBeGreaterThanOrEqual(KEY_SPACING);
        });
      });
    }
  });

  it('scatters reachable throwables, one of them near the spawn, never on a key', () => {
    for (const seed of SEEDS) {
      const { keys, throwables } = scatterItems(level, seedrandom(seed));
      expect(throwables).toHaveLength(THROWABLE_COUNT);
      expect(walk(throwables[0])).toBeLessThanOrEqual(STARTER_WALK);
      throwables.forEach((cell) => {
        expect(walk(cell)).toBeLessThan(Infinity);
        expect(keys.some((key) => sameCell(key, cell))).toBe(false);
      });
    }
  });

  it('lays the keys out differently from run to run, but the same for the same seed', () => {
    const layout = (seed) => JSON.stringify(scatterItems(level, seedrandom(seed)).keys);
    expect(layout('a')).toBe(layout('a'));
    expect(new Set(SEEDS.map(layout)).size).toBeGreaterThan(SEEDS.length * 0.9);
  });

  it('leaves the parsed level untouched', () => {
    const before = JSON.stringify(level);
    scatterItems(level, seedrandom('x'));
    expect(JSON.stringify(level)).toBe(before);
  });
});
