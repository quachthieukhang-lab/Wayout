import { isWalkable, isTransparent, worldToCell } from './level.js';

const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const SIGHT_SAMPLE_STEP = 0.25;

/**
 * Breadth-first search over walkable cells.
 * @param {import('./level.js').Level} level
 * @param {import('./level.js').Cell} start
 * @param {import('./level.js').Cell} goal
 * @param {(level: import('./level.js').Level, x: number, z: number) => boolean} [canEnter] which cells may be crossed
 * @returns {import('./level.js').Cell[] | null} cells after `start` up to and including `goal`, or null if unreachable
 */
export function findPath(level, start, goal, canEnter = isWalkable) {
  if (!canEnter(level, start.x, start.z) || !canEnter(level, goal.x, goal.z)) return null;

  const index = (x, z) => z * level.width + x;
  const cameFrom = new Map([[index(start.x, start.z), -1]]);
  const queue = [start];

  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head];
    if (cell.x === goal.x && cell.z === goal.z) return rebuildPath(cameFrom, index(goal.x, goal.z), level.width);

    for (const [dx, dz] of DIRECTIONS) {
      const x = cell.x + dx;
      const z = cell.z + dz;
      if (!canEnter(level, x, z) || cameFrom.has(index(x, z))) continue;
      cameFrom.set(index(x, z), index(cell.x, cell.z));
      queue.push({ x, z });
    }
  }
  return null;
}

function rebuildPath(cameFrom, goalIndex, width) {
  const path = [];
  for (let i = goalIndex; cameFrom.get(i) !== -1; i = cameFrom.get(i)) {
    path.push({ x: i % width, z: Math.floor(i / width) });
  }
  return path.reverse();
}

/**
 * True when the straight segment between two world points crosses only clear cells.
 * @param {import('./level.js').Level} level
 * @param {{ x: number, z: number }} from
 * @param {{ x: number, z: number }} to
 * @param {(level: import('./level.js').Level, x: number, z: number) => boolean} [isClear] sight passes walls-only by default;
 *   pass `isWalkable` to also treat low furniture as blocking (a crouched player behind a bed)
 */
export function hasLineOfSight(level, from, to, isClear = isTransparent) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const samples = Math.ceil(Math.hypot(dx, dz) / SIGHT_SAMPLE_STEP);
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    const cell = worldToCell(from.x + dx * t, from.z + dz * t);
    if (!isClear(level, cell.x, cell.z)) return false;
  }
  return true;
}
