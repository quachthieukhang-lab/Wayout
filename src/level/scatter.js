import { findPath } from './pathfinding.js';

export const KEY_COUNT = 5;
export const KEY_SPACING = 7; // cells (straight line) between two keys, so they end up in different rooms
export const KEY_MIN_WALK = 8; // cells of walking from the spawn to any key
export const THROWABLE_COUNT = 8;
const THROWABLE_SPACING = 4;
export const STARTER_WALK = 4; // one throwable always lies within this many cells of walking from the spawn
export const PAGE_COUNT = 7; // journal pages: optional, and how many you read decides the ending
const PAGE_SPACING = 5;
export const TAPE_COUNT = 3; // the last one is Marrow's own, in his office
const TAPE_SPACING = 6;
export const BANDAGE_COUNT = 2;
export const FLARE_COUNT = 2;
const SUPPLY_SPACING = 6;
export const MAP_WALK = Object.freeze({ min: 5, max: 14 }); // the floor plan lies a short walk from the spawn
const FREE_TILES = new Set(['.', 'L']); // plain floor: not a locker, vent, battery, spawn or fixed key

/**
 * @typedef {import('./level.js').Cell} Cell
 * @typedef {{ x0: number, z0: number, x1: number, z1: number }} Area
 */

/**
 * Scatters the keys, throwables, journal pages, tapes, the floor plan and the supplies (bandages, flares) over free
 * floor cells, differently on every run. Every cell it picks is reachable from the spawn, and no two items share one.
 * Keys keep apart and away from the spawn; one throwable lies near the spawn to learn with.
 * @param {import('./level.js').Level} level
 * @param {() => number} [rng]
 * @param {{ tapeRoom?: Area | null }} [options] where the last tape always lies (Marrow's office)
 * @returns {import('./level.js').Level} a copy with the item lists filled in
 */
export function scatterItems(level, rng = Math.random, { tapeRoom = null } = {}) {
  const free = level.floorCells
    .filter((cell) => FREE_TILES.has(level.tiles[cell.z][cell.x]))
    .map((cell) => ({ cell, walk: findPath(level, level.spawn, cell)?.length ?? Infinity }))
    .filter(({ walk }) => walk < Infinity);
  const cellsWhere = (test) => free.filter(({ cell, walk }) => test(walk, cell)).map(({ cell }) => cell);
  /** @type {Cell[]} */
  const taken = [];
  /** Picks `count` cells passing `test` and marks them taken. */
  const place = (count, spacing, test = () => true) => {
    const picked = spreadOut(cellsWhere(test), count, spacing, taken, rng);
    taken.push(...picked);
    return picked;
  };

  const keys = place(KEY_COUNT, KEY_SPACING, (walk) => walk >= KEY_MIN_WALK);
  const starter = place(1, 1, (walk) => walk <= STARTER_WALK);
  const throwables = [...starter, ...place(THROWABLE_COUNT - starter.length, THROWABLE_SPACING)];
  const maps = place(1, 1, (walk) => walk >= MAP_WALK.min && walk <= MAP_WALK.max);
  const marrowTape = tapeRoom ? place(1, 1, (_, cell) => isInside(tapeRoom, cell)) : [];
  const tapes = [
    ...place(TAPE_COUNT - marrowTape.length, TAPE_SPACING, (_, cell) => !tapeRoom || !isInside(tapeRoom, cell)),
    ...marrowTape,
  ];
  const pages = place(PAGE_COUNT, PAGE_SPACING);
  const bandages = place(BANDAGE_COUNT, SUPPLY_SPACING);
  const flares = place(FLARE_COUNT, SUPPLY_SPACING);
  return { ...level, keys, throwables, maps, tapes, pages, bandages, flares };
}

/** @param {Area} area @param {Cell} cell */
function isInside(area, cell) {
  return cell.x >= area.x0 && cell.x <= area.x1 && cell.z >= area.z0 && cell.z <= area.z1;
}

/**
 * Picks up to `count` random cells at least `spacing` apart from each other and from `taken`. When the cells run
 * out, it relaxes the spacing one cell at a time (never below 1, so no two items share a cell).
 * @param {Cell[]} candidates
 * @param {number} count
 * @param {number} spacing
 * @param {Cell[]} taken
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

/** Fisher–Yates on a copy. @template T @param {readonly T[]} items @param {() => number} rng @returns {T[]} */
export function shuffle(items, rng) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
