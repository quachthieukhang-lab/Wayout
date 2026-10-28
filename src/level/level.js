// Grid-based level. Each character is one CELL_SIZE x CELL_SIZE cell:
//   #  wall          .  floor        P  player spawn   M  monster spawn
//   K  fixed key     B  battery      L  ceiling lamp   E  exit door (in the outer wall)
//      (LEVEL_MAP has no K: scatterItems places KEY_COUNT keys at random each run)
//   V  crawl vent: low duct the player can crouch through but the monster cannot enter
//   S  tall shelving: blocks movement and sight (cover)
//   T  bed / gurney: blocks movement but it can see over it, unless you crouch behind it
//   H  locker against a wall: hide inside it
//   O  bottle or can placed by hand (the tutorial; the main map scatters them at random)
export const CELL_SIZE = 3;
export const WALL_HEIGHT = 3.4;

// Abandoned hospital: two wards, an office, the archive, storage, the lobby, surgery and the morgue,
// joined by two long corridors. Vents (V) are shortcuts it cannot follow you through.
export const LEVEL_MAP = Object.freeze([
  '#############################',
  '#T.T.T.#H.....H#............#',
  '#.P...L#.T.T.T.#.SS.SS.SS.S.#',
  '#T.T.T.V.......#.....L......#',
  '#......#.T.T.T.#.SS.SS.SS.S.#',
  '#H.....#B......#H.........H.#',
  '###.#######.######.######.###',
  '#H....L....................H#',
  '####.######.####.######.#####',
  '#B..L..#....L.....#S......S.#',
  '#.S.S.S#.TTT..TTT.#..T..T...#',
  '#.S.S.S#....M.....V...L.....#',
  '#.......V......B..#..T..T...#',
  '#H.....H#H........H#H......H#',
  '##.##########.###########.###',
  '#.......L.H.................#',
  '######.#####V#######.########',
  '#SS.S..S.SS...#T.T.T.T.T.T.T#',
  '#...T..T..T.L.V.....L.......E',
  '#H..........BH#T.T.T.T.T...H#',
  '#############################',
]);

/**
 * Rooms of LEVEL_MAP as cell rectangles (inclusive), each painted its own colour so the player can tell them apart.
 * A rectangle may include wall cells; only its floor cells count. Doorways between a room and a hall belong to neither.
 * @typedef {{ name: string, color: number, isHall: boolean, x0: number, z0: number, x1: number, z1: number }} Room
 * @type {readonly Room[]}
 */
export const ROOMS = Object.freeze([
  { name: 'WARD A', color: 0x4f8a5c, isHall: false, x0: 1, z0: 1, x1: 6, z1: 5 },
  { name: 'WARD B', color: 0x4a6f9a, isHall: false, x0: 8, z0: 1, x1: 14, z1: 5 },
  { name: 'ARCHIVE', color: 0x8a6034, isHall: false, x0: 16, z0: 1, x1: 27, z1: 5 },
  { name: 'NORTH HALL', color: 0x7a2a2a, isHall: true, x0: 1, z0: 7, x1: 27, z1: 7 },
  { name: 'STORAGE', color: 0x8a8238, isHall: false, x0: 1, z0: 9, x1: 7, z1: 13 },
  { name: 'LOBBY', color: 0x8a4a6a, isHall: false, x0: 8, z0: 9, x1: 18, z1: 13 },
  { name: 'SURGERY', color: 0x3a8a86, isHall: false, x0: 19, z0: 9, x1: 27, z1: 13 },
  { name: 'SOUTH HALL', color: 0x9a6a20, isHall: true, x0: 1, z0: 15, x1: 27, z1: 15 },
  { name: 'OFFICE', color: 0x6a5a92, isHall: false, x0: 1, z0: 17, x1: 13, z1: 19 },
  { name: 'MORGUE', color: 0xa8b4ba, isHall: false, x0: 15, z0: 17, x1: 27, z1: 19 },
]);

/** @param {readonly Room[]} rooms @param {Cell} cell @returns {Room | null} */
export function roomAt(rooms, cell) {
  return rooms.find((r) => cell.x >= r.x0 && cell.x <= r.x1 && cell.z >= r.z0 && cell.z <= r.z1) ?? null;
}

const BLOCKING_TILES = new Set(['#', 'E', 'S', 'T']);
const OPAQUE_TILES = new Set(['#', 'E', 'S']);
/** @type {[number, number][]} */
const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * @typedef {{ x: number, z: number }} Cell
 * @typedef {{
 *   width: number, height: number, tiles: readonly string[], walls: boolean[][], opaque: boolean[][],
 *   floorCells: Cell[], monsterCells: Cell[], spawn: Cell, monsterSpawn: Cell, exit: Cell,
 *   keys: Cell[], batteries: Cell[], lamps: Cell[], vents: Cell[], shelves: Cell[], beds: Cell[], lockers: Cell[],
 *   throwables: Cell[]
 * }} Level
 */

/**
 * @param {readonly string[]} rows
 * @returns {Level}
 */
export function parseLevel(rows) {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  if (height === 0 || rows.some((row) => row.length !== width)) {
    throw new Error('Level map must be a non-empty grid with equal row lengths');
  }

  const level = {
    width,
    height,
    tiles: rows,
    walls: [],
    opaque: [],
    floorCells: [],
    monsterCells: [],
    spawn: null,
    monsterSpawn: null,
    exit: null,
    keys: [],
    batteries: [],
    lamps: [],
    vents: [],
    shelves: [],
    beds: [],
    lockers: [],
    throwables: [], // `O` tiles, or filled in by scatterItems
  };
  const markers = { P: 'spawn', M: 'monsterSpawn', E: 'exit' };
  const lists = {
    K: level.keys,
    B: level.batteries,
    L: level.lamps,
    V: level.vents,
    S: level.shelves,
    T: level.beds,
    H: level.lockers,
    O: level.throwables,
  };

  rows.forEach((row, z) => {
    level.opaque.push([...row].map((tile) => OPAQUE_TILES.has(tile)));
    level.walls.push(
      [...row].map((tile, x) => {
        const cell = { x, z };
        if (markers[tile]) level[markers[tile]] = cell;
        lists[tile]?.push(cell);
        const isBlocking = BLOCKING_TILES.has(tile);
        if (!isBlocking) level.floorCells.push(cell);
        if (!isBlocking && tile !== 'V') level.monsterCells.push(cell);
        return isBlocking;
      }),
    );
  });

  for (const name of Object.values(markers)) {
    if (!level[name]) throw new Error(`Level map is missing its ${name} marker`);
  }
  for (const cell of level.lockers) {
    if (!lockerWall(level, cell)) throw new Error(`Locker at ${cell.x},${cell.z} has no wall to stand against`);
  }
  return level;
}

const isInside = (level, x, z) => x >= 0 && z >= 0 && x < level.width && z < level.height;

/** Nothing blocks movement here. @param {Level} level @param {number} x @param {number} z */
export function isWalkable(level, x, z) {
  return isInside(level, x, z) && !level.walls[z][x];
}

/** Sight passes through (floors, vents, low beds). @param {Level} level @param {number} x @param {number} z */
export function isTransparent(level, x, z) {
  return isInside(level, x, z) && !level.opaque[z][x];
}

/** @param {Level} level @param {number} x @param {number} z */
export function isWallTile(level, x, z) {
  return isInside(level, x, z) && level.tiles[z][x] === '#';
}

/** @param {Level} level @param {number} x @param {number} z */
export function isVent(level, x, z) {
  return level.vents.some((cell) => cell.x === x && cell.z === z);
}

/** Walkable and not a vent (the monster is too big for the ducts). @param {Level} level @param {number} x @param {number} z */
export function isMonsterWalkable(level, x, z) {
  return isWalkable(level, x, z) && !isVent(level, x, z);
}

/**
 * Direction from a locker cell to the wall it stands against, or null.
 * @param {Level} level @param {Cell} cell @returns {[number, number] | null}
 */
export function lockerWall(level, cell) {
  return DIRECTIONS.find(([dx, dz]) => isWallTile(level, cell.x + dx, cell.z + dz)) ?? null;
}

/** The floor cell in front of the exit door. @param {Level} level @returns {Cell} */
export function exitApproach(level) {
  const [dx, dz] = DIRECTIONS.find(([x, z]) => isWalkable(level, level.exit.x + x, level.exit.z + z)) ?? [0, 0];
  return { x: level.exit.x + dx, z: level.exit.z + dz };
}

/** Center of a cell in world space (y = 0). @param {Cell} cell */
export function cellToWorld(cell) {
  return { x: cell.x * CELL_SIZE, z: cell.z * CELL_SIZE };
}

/** @param {number} x @param {number} z world coordinates @returns {Cell} */
export function worldToCell(x, z) {
  return { x: Math.round(x / CELL_SIZE), z: Math.round(z / CELL_SIZE) };
}
