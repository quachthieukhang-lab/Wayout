import { describe, it, expect } from 'vitest';
import {
  LEVEL_MAP,
  ROOMS,
  roomAt,
  parseLevel,
  cellToWorld,
  worldToCell,
  isWalkable,
  isMonsterWalkable,
  lockerWall,
} from '../src/level/level.js';
import { findPath, hasLineOfSight } from '../src/level/pathfinding.js';

const SMALL_MAP = ['#######', '#P..#.#', '#.#.#.#', '#...M#E', '#######'];

describe('parseLevel', () => {
  it('reads markers, walls and floor cells', () => {
    const level = parseLevel(SMALL_MAP);
    expect(level.width).toBe(7);
    expect(level.height).toBe(5);
    expect(level.spawn).toEqual({ x: 1, z: 1 });
    expect(level.monsterSpawn).toEqual({ x: 4, z: 3 });
    expect(level.exit).toEqual({ x: 6, z: 3 });
    expect(isWalkable(level, 6, 3)).toBe(false); // the exit door is solid
    expect(isWalkable(level, -1, 0)).toBe(false);
  });

  it('rejects ragged maps and maps without markers', () => {
    expect(() => parseLevel(['###', '##'])).toThrow();
    expect(() => parseLevel(['###', '#.#', '###'])).toThrow(/spawn/);
  });

  it('converts between cells and world positions', () => {
    const world = cellToWorld({ x: 4, z: 2 });
    expect(worldToCell(world.x + 1.2, world.z - 1.2)).toEqual({ x: 4, z: 2 });
  });
});

describe('main level', () => {
  const level = parseLevel(LEVEL_MAP);
  const reachable = (cell) => findPath(level, level.spawn, cell) !== null;

  it('places no fixed keys (they are scattered each run) and every battery is reachable from the spawn', () => {
    expect(level.keys).toHaveLength(0);
    [...level.batteries, level.monsterSpawn].forEach((cell) => expect(reachable(cell)).toBe(true));
  });

  it('splits the hospital into named rooms that fit the map and do not overlap', () => {
    expect(new Set(ROOMS.map((room) => room.name)).size).toBe(ROOMS.length);
    expect(new Set(ROOMS.map((room) => room.color)).size).toBe(ROOMS.length);
    for (const room of ROOMS) {
      expect(room.x0).toBeGreaterThanOrEqual(0);
      expect(room.z0).toBeGreaterThanOrEqual(0);
      expect(room.x1).toBeLessThan(level.width);
      expect(room.z1).toBeLessThan(level.height);
      expect(level.floorCells.some((cell) => roomAt([room], cell))).toBe(true);
    }
    level.floorCells.forEach((cell) => {
      expect(ROOMS.filter((room) => roomAt([room], cell)).length).toBeLessThanOrEqual(1);
    });
  });

  it('puts every floor cell in a room, except doorways and vents squeezed between two walls', () => {
    const isWall = (x, z) => !isWalkable(level, x, z);
    level.floorCells
      .filter((cell) => roomAt(ROOMS, cell) === null)
      .forEach(({ x, z }) => {
        expect((isWall(x - 1, z) && isWall(x + 1, z)) || (isWall(x, z - 1) && isWall(x, z + 1))).toBe(true);
      });
  });

  it('has a reachable floor cell in front of the exit door', () => {
    const { x, z } = level.exit;
    const neighbours = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].map(([dx, dz]) => ({ x: x + dx, z: z + dz }));
    expect(neighbours.some((c) => isWalkable(level, c.x, c.z) && reachable(c))).toBe(true);
  });

  it('lets the player reach every floor cell and the monster reach every room', () => {
    level.floorCells.forEach((cell) => expect(reachable(cell)).toBe(true));
    const monsterReach = (cell) => findPath(level, level.monsterSpawn, cell, isMonsterWalkable) !== null;
    level.monsterCells.forEach((cell) => expect(monsterReach(cell)).toBe(true));
  });

  it('has lockers to hide in, each standing against a wall', () => {
    expect(level.lockers.length).toBeGreaterThanOrEqual(8);
    level.lockers.forEach((cell) => expect(lockerWall(level, cell)).not.toBeNull());
  });

  it('puts every vent between two floor cells so it is a real shortcut', () => {
    level.vents.forEach(({ x, z }) => {
      const across = isWalkable(level, x - 1, z) && isWalkable(level, x + 1, z);
      const along = isWalkable(level, x, z - 1) && isWalkable(level, x, z + 1);
      expect(across || along).toBe(true);
    });
  });
});

describe('furniture', () => {
  const level = parseLevel(['#########', '#P.T.S.M#', '#......#E', '#########']);

  it('blocks movement with beds and shelves but only shelves block sight', () => {
    expect(isWalkable(level, 3, 1)).toBe(false);
    expect(isWalkable(level, 5, 1)).toBe(false);
    expect(level.floorCells.some((c) => c.x === 3 && c.z === 1)).toBe(false);

    const left = cellToWorld({ x: 2, z: 1 });
    const right = cellToWorld({ x: 4, z: 1 });
    expect(hasLineOfSight(level, left, right)).toBe(true); // it sees over the bed...
    expect(hasLineOfSight(level, left, right, isWalkable)).toBe(false); // ...but not someone crouched behind it
    expect(hasLineOfSight(level, right, cellToWorld({ x: 6, z: 1 }))).toBe(false); // shelves are cover
  });

  it('rejects a locker with no wall behind it', () => {
    expect(() => parseLevel(['#####', '#P..#', '#.H.E', '#..M#', '#####'])).toThrow(/Locker/);
  });
});

describe('pathfinding', () => {
  const level = parseLevel(SMALL_MAP);

  it('finds the shortest path around walls', () => {
    const path = findPath(level, { x: 1, z: 1 }, { x: 3, z: 1 });
    expect(path).toHaveLength(2);
    expect(path.at(-1)).toEqual({ x: 3, z: 1 });
  });

  it('lets the player crawl through vents but routes the monster around them', () => {
    const vented = parseLevel(['#######', '#P.V.M#', '#.###.#', '#.....E', '#######']);
    const from = { x: 1, z: 1 };
    const to = { x: 5, z: 1 };
    expect(findPath(vented, from, to)).toHaveLength(4); // straight through the vent
    expect(findPath(vented, from, to, isMonsterWalkable)).toHaveLength(8); // the long way round
    expect(vented.monsterCells.some((c) => c.x === 3 && c.z === 1)).toBe(false);
  });

  it('returns null for unreachable or solid goals', () => {
    expect(findPath(level, { x: 1, z: 1 }, { x: 5, z: 1 })).toBeNull();
    expect(findPath(level, { x: 1, z: 1 }, { x: 0, z: 0 })).toBeNull();
  });

  it('detects line of sight blocked by walls', () => {
    const a = cellToWorld({ x: 1, z: 3 });
    expect(hasLineOfSight(level, a, cellToWorld({ x: 4, z: 3 }))).toBe(true);
    expect(hasLineOfSight(level, a, cellToWorld({ x: 3, z: 1 }))).toBe(false);
  });
});
