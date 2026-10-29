import { describe, it, expect } from 'vitest';
import seedrandom from 'seedrandom';
import { LEVEL_MAP, ROOMS, parseLevel, roomAt, isWalkable } from '../src/level/level.js';
import { blockPassages, isFullyConnected, LOCKED_DOORS, BARRICADES } from '../src/level/blockers.js';

const SEEDS = Array.from({ length: 25 }, (_, i) => `blocked-${i}`);
const count = (rows, tile) => rows.join('').split(tile).length - 1;

describe('blockPassages', () => {
  it('chains some doors shut and blocks some hall cells, every run', () => {
    for (const seed of SEEDS) {
      const rows = blockPassages(LEVEL_MAP, ROOMS, seedrandom(seed));
      expect(count(rows, 'X')).toBe(LOCKED_DOORS);
      expect(count(rows, 'Z')).toBe(BARRICADES);
      expect(count(rows, 'D') + count(rows, 'X')).toBe(count(LEVEL_MAP, 'D')); // a locked door was a door
    }
  });

  it('never cuts off a floor cell from the player or a cell from the monster', () => {
    for (const seed of SEEDS) {
      const level = parseLevel(blockPassages(LEVEL_MAP, ROOMS, seedrandom(seed)));
      expect(isFullyConnected(level)).toBe(true);
    }
  });

  it('only drops rubble into the halls, and blocks both movement and sight', () => {
    for (const seed of SEEDS) {
      const level = parseLevel(blockPassages(LEVEL_MAP, ROOMS, seedrandom(seed)));
      level.barricades.forEach((cell) => {
        expect(roomAt(ROOMS, cell)?.isHall).toBe(true);
        expect(isWalkable(level, cell.x, cell.z)).toBe(false);
        expect(level.opaque[cell.z][cell.x]).toBe(true);
      });
      level.lockedDoors.forEach((cell) => expect(isWalkable(level, cell.x, cell.z)).toBe(false));
    }
  });

  it('lays the blockers out differently from run to run', () => {
    const layout = (seed) => blockPassages(LEVEL_MAP, ROOMS, seedrandom(seed)).join('');
    expect(new Set(SEEDS.map(layout)).size).toBeGreaterThan(SEEDS.length / 2);
  });

  it('gives up on a blocker that would strand a room', () => {
    // The only door into the east room: locking it would cut the room off.
    const map = ['#########', '#P...#..#', '#....D..#', '#M...#..E', '#########'];
    expect(blockPassages(map, [], seedrandom('x'), { lockedDoors: 1, barricades: 0 })).toEqual(map);
  });
});
