import { describe, it, expect } from 'vitest';
import seedrandom from 'seedrandom';
import { LEVEL_MAP, ROOMS, MARROW_OFFICE, parseLevel, roomAt, isWalkable } from '../src/level/level.js';
import { findPath } from '../src/level/pathfinding.js';
import {
  scatterItems,
  KEY_COUNT,
  KEY_SPACING,
  KEY_MIN_WALK,
  THROWABLE_COUNT,
  STARTER_WALK,
  PAGE_COUNT,
  TAPE_COUNT,
  BANDAGE_COUNT,
  FLARE_COUNT,
  MAP_WALK,
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

  it('scatters pages, tapes, a floor plan and supplies, each on its own reachable cell', () => {
    const office = ROOMS.find((room) => room.name === MARROW_OFFICE);
    for (const seed of SEEDS) {
      const run = scatterItems(level, seedrandom(seed), { tapeRoom: office });
      expect(run.pages).toHaveLength(PAGE_COUNT);
      expect(run.tapes).toHaveLength(TAPE_COUNT);
      expect(run.bandages).toHaveLength(BANDAGE_COUNT);
      expect(run.flares).toHaveLength(FLARE_COUNT);
      expect(run.maps).toHaveLength(1);
      expect(walk(run.maps[0])).toBeGreaterThanOrEqual(MAP_WALK.min);
      expect(walk(run.maps[0])).toBeLessThanOrEqual(MAP_WALK.max);
      expect(roomAt([office], run.tapes.at(-1))).not.toBeNull(); // Marrow's own tape, in his office

      const all = [run.keys, run.throwables, run.pages, run.tapes, run.maps, run.bandages, run.flares].flat();
      all.forEach((cell) => expect(walk(cell)).toBeLessThan(Infinity));
      expect(new Set(all.map((cell) => `${cell.x},${cell.z}`)).size).toBe(all.length);
    }
  });
});
