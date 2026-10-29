import { parseLevel, roomAt, isWalkable, isMonsterWalkable } from './level.js';
import { shuffle } from './scatter.js';

export const LOCKED_DOORS = 2;
export const BARRICADES = 2;
const BARRICADE_TILES = new Set(['.']); // plain hall floor: not a lamp, glass or boards
const SPAWN_CLEARANCE = 3; // cells: nothing is blocked right next to where a run starts
/** @type {[number, number][]} */
const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Changes the hospital a little every run: chains a few doors shut (X) and drops rubble into a few hall cells (Z).
 * A blocker is only kept if the player can still reach every floor cell from the spawn and the monster every one of
 * its cells, so a run never strands a key, the exit or a room.
 * @param {readonly string[]} rows the map
 * @param {readonly import('./level.js').Room[]} rooms barricades only go into halls
 * @param {() => number} [rng]
 * @param {{ lockedDoors?: number, barricades?: number }} [counts]
 * @returns {string[]} a new map
 */
export function blockPassages(rows, rooms, rng = Math.random, counts = {}) {
  const { lockedDoors = LOCKED_DOORS, barricades = BARRICADES } = counts;
  const level = parseLevel(rows);
  const isFarFromSpawn = (cell) =>
    Math.abs(cell.x - level.spawn.x) + Math.abs(cell.z - level.spawn.z) > SPAWN_CLEARANCE;
  const halls = rooms.filter((room) => room.isHall);
  const hallCells = level.floorCells.filter(
    (cell) => BARRICADE_TILES.has(level.tiles[cell.z][cell.x]) && roomAt(halls, cell) !== null,
  );

  let map = [...rows];
  const tryBlock = (candidates, tile, count) => {
    let placed = 0;
    for (const cell of shuffle(candidates.filter(isFarFromSpawn), rng)) {
      if (placed === count) break;
      const next = setTile(map, cell, tile);
      if (!isFullyConnected(parseLevel(next))) continue;
      map = next;
      placed++;
    }
  };
  tryBlock(level.doors, 'X', lockedDoors);
  tryBlock(hallCells, 'Z', barricades);
  return map;
}

/**
 * The player reaches every floor cell from the spawn, and the monster every monster cell from its spawn.
 * @param {import('./level.js').Level} level
 */
export function isFullyConnected(level) {
  const playerReach = flood(level, level.spawn, isWalkable);
  const monsterReach = flood(level, level.monsterSpawn, isMonsterWalkable);
  return (
    level.floorCells.every((cell) => playerReach.has(key(cell))) &&
    level.monsterCells.every((cell) => monsterReach.has(key(cell)))
  );
}

/** @param {import('./level.js').Cell} cell */
const key = (cell) => `${cell.x},${cell.z}`;

/**
 * Every cell reachable from `start` (breadth first).
 * @param {import('./level.js').Level} level @param {import('./level.js').Cell} start
 * @param {(level: import('./level.js').Level, x: number, z: number) => boolean} isOpen
 */
function flood(level, start, isOpen) {
  const seen = new Set([key(start)]);
  const queue = [start];
  while (queue.length > 0) {
    const cell = queue.shift();
    for (const [dx, dz] of STEPS) {
      const next = { x: cell.x + dx, z: cell.z + dz };
      if (seen.has(key(next)) || !isOpen(level, next.x, next.z)) continue;
      seen.add(key(next));
      queue.push(next);
    }
  }
  return seen;
}

/** @param {readonly string[]} rows @param {import('./level.js').Cell} cell @param {string} tile */
function setTile(rows, cell, tile) {
  return rows.map((row, z) => (z === cell.z ? row.slice(0, cell.x) + tile + row.slice(cell.x + 1) : row));
}
