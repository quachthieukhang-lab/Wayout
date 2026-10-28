import { findPath } from './pathfinding.js';

export const KEY_COUNT = 5;
export const KEY_SPACING = 7; // cells (straight line) between two keys, so they end up in different rooms
export const KEY_MIN_WALK = 8; // cells of walking from the spawn to any key
export const THROWABLE_COUNT = 8;
const THROWABLE_SPACING = 4;
export const STARTER_WALK = 4; // one throwable always lies within this many cells of walking from the spawn
const FREE_TILES = new Set(['.', 'L']); // plain floor: not a locker, vent, battery, spawn or fixed key

/**
 * Scatters the keys and the throwables over free floor cells, differently on every run. Every cell it picks is
 * reachable from the spawn. Keys keep apart and away from the spawn; one throwable lies near the spawn to learn with.
 * @param {import('./level.js').Level} level
 * @param {() => number} [rng]
 * @returns {import('./level.js').Level} a copy with `keys` and `throwables` filled in
 */
export function scatterItems(level, rng = Math.random) {
  const free = level.floorCells
    .filter((cell) => FREE_TILES.has(level.tiles[cell.z][cell.x]))
    .map((cell) => ({ cell, walk: findPath(level, level.spawn, cell)?.length ?? Infinity }))
    .filter(({ walk }) => walk < Infinity);
  const cellsWhere = (test) => free.filter(({ walk }) => test(walk)).map(({ cell }) => cell);

  const keys = spreadOut(
    cellsWhere((walk) => walk >= KEY_MIN_WALK),
    KEY_COUNT,
    KEY_SPACING,
    [],
    rng,
  );
  const starter = spreadOut(
    cellsWhere((walk) => walk <= STARTER_WALK),
    1,
    1,
    keys,
    rng,
  );
  const others = spreadOut(
    cellsWhere(() => true),
    THROWABLE_COUNT - starter.length,
    THROWABLE_SPACING,
    [...keys, ...starter],
    rng,
  );
  return { ...level, keys, throwables: [...starter, ...others] };
}

/**
 * Picks up to `count` random cells at least `spacing` apart from each other and from `taken`. When the cells run
 * out, it relaxes the spacing one cell at a time (never below 1, so no two items share a cell).
 * @param {import('./level.js').Cell[]} candidates
 * @param {number} count
 * @param {number} spacing
 * @param {import('./level.js').Cell[]} taken
 * @param {() => number} rng
 */
function spreadOut(candidates, count, spacing, taken, rng) {
  const order = shuffle(candidates, rng);
  const picked = [];
  for (let gap = spacing; picked.length < count && gap >= 1; gap--) {
    for (const cell of order) {
      if (picked.length === count) break;
      if ([...taken, ...picked].every((other) => Math.hypot(cell.x - other.x, cell.z - other.z) >= gap)) {
        picked.push(cell);
      }
    }
  }
  return picked;
}

/** Fisher–Yates on a copy. @template T @param {T[]} items @param {() => number} rng @returns {T[]} */
function shuffle(items, rng) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
