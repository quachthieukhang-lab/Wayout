import { CELL_SIZE, cellToWorld, isWalkable, worldToCell } from '../level/level.js';
import { findPath } from '../level/pathfinding.js';

const DURATION = 6; // seconds the sense lasts
const COOLDOWN = 15; // seconds from one use to the next
const REPATH_INTERVAL = 0.25;
const LOOK_AHEAD = 2; // aim this many cells along the route, so the arrow bends around corners
const NEIGHBOURS = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * @typedef {{ aim: { x: number, z: number }, distance: number }} Route
 *   `aim` is the world point to head for next, `distance` the walking distance in metres.
 */

/**
 * Shortest walking route (through vents too) from a cell to the nearest of several goals.
 * @param {import('../level/level.js').Level} level
 * @param {import('../level/level.js').Cell} from may be a blocked cell (e.g. the edge of a bed); its open neighbours are tried
 * @param {import('../level/level.js').Cell[]} goals
 * @returns {Route | null} null when no goal is reachable
 */
export function findNearestRoute(level, from, goals) {
  const start = NEIGHBOURS.map(([dx, dz]) => ({ x: from.x + dx, z: from.z + dz })).find((cell) =>
    isWalkable(level, cell.x, cell.z),
  );
  if (!start) return null;

  let best = null;
  for (const goal of goals) {
    const path = findPath(level, start, goal);
    if (path && (best === null || path.length < best.length)) best = path;
  }
  if (best === null) return null;

  const aimCell = best.length === 0 ? start : best[Math.min(LOOK_AHEAD, best.length) - 1];
  return { aim: cellToWorld(aimCell), distance: best.length * CELL_SIZE };
}

/** "Sense the keys": for a few seconds it shows the way to the nearest key, then needs time to recover. */
export class KeySense {
  /** @param {import('../level/level.js').Level} level */
  constructor(level) {
    this.level = level;
    this.timeLeft = 0;
    this.cooldown = 0;
    this.cooldownScale = 1; // difficulty
    this.repathTimer = 0;
    /** @type {Route | null} */
    this.route = null;
  }

  get isActive() {
    return this.timeLeft > 0;
  }

  /** @returns {boolean} false while still recovering */
  activate() {
    if (this.cooldown > 0) return false;
    this.timeLeft = DURATION;
    this.cooldown = COOLDOWN * this.cooldownScale;
    this.repathTimer = 0;
    return true;
  }

  /**
   * @param {number} dt
   * @param {{ x: number, z: number }} position the player's world position
   * @param {import('../level/level.js').Cell[]} goals
   * @returns {Route | null} the route while the sense is active
   */
  update(dt, position, goals) {
    this.cooldown = Math.max(this.cooldown - dt, 0);
    this.timeLeft = Math.max(this.timeLeft - dt, 0);
    if (!this.isActive) {
      this.route = null;
      return null;
    }
    this.repathTimer -= dt;
    if (this.repathTimer <= 0) {
      this.repathTimer = REPATH_INTERVAL;
      this.route = findNearestRoute(this.level, worldToCell(position.x, position.z), goals);
    }
    return this.route;
  }
}
