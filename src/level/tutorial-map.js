// The tutorial: one fixed path through seven small rooms, each teaching one skill (see core/tutorial.js).
// Same legend as LEVEL_MAP, plus `O` for a bottle or can placed by hand (the first one is a bottle).
//
//   top band, left to right:    WAKE ROOM → QUIET HALL → (vent) → DARK ROOM → ARCHIVE
//   bottom band, right to left: LOCKERS → SUPPLY ROOM → EXIT HALL → exit door
export const TUTORIAL_MAP = Object.freeze([
  '##############################',
  '#..L.############....B#......#',
  '#.P.......L.....V.......SS.SS#',
  '#....############.T.T.#L.....#',
  '#T...############.....#SS.S.K#',
  '#########################.####',
  '#.K.....#.M........#H.......H#',
  '#.......#..TT...O..#.........#',
  'E...L........L..........L....#',
  '#.......#..TT......#.........#',
  '#H......#.......O..#H.......H#',
  '##############################',
]);

/** @type {readonly import('./level.js').Room[]} */
export const TUTORIAL_ROOMS = Object.freeze([
  { name: 'WAKE ROOM', color: 0x4f8a5c, isHall: false, x0: 1, z0: 1, x1: 4, z1: 4 },
  { name: 'QUIET HALL', color: 0x7a2a2a, isHall: true, x0: 5, z0: 2, x1: 15, z1: 2 },
  { name: 'DARK ROOM', color: 0x4a6f9a, isHall: false, x0: 17, z0: 1, x1: 21, z1: 4 },
  { name: 'ARCHIVE', color: 0x8a6034, isHall: false, x0: 23, z0: 1, x1: 28, z1: 4 },
  { name: 'LOCKERS', color: 0x3a8a86, isHall: false, x0: 20, z0: 6, x1: 28, z1: 10 },
  { name: 'SUPPLY ROOM', color: 0x8a8238, isHall: false, x0: 9, z0: 6, x1: 18, z1: 10 },
  { name: 'EXIT HALL', color: 0xa8b4ba, isHall: false, x0: 1, z0: 6, x1: 7, z1: 10 },
]);
