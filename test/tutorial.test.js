import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { parseLevel, roomAt, isWalkable, isMonsterWalkable, cellToWorld } from '../src/level/level.js';
import { findPath } from '../src/level/pathfinding.js';
import { TUTORIAL_MAP, TUTORIAL_ROOMS } from '../src/level/tutorial-map.js';
import { Tutorial, TUTORIAL_STEPS } from '../src/core/tutorial.js';
import { Monster, MonsterState } from '../src/monster/monster.js';

const DT = 1 / 60;
const level = parseLevel(TUTORIAL_MAP);
const reachable = (cell) => findPath(level, level.spawn, cell) !== null;

/** A step snapshot: the player standing somewhere, nothing done yet, the monster calm. */
const at = (x, z, overrides = {}) => ({
  cell: { x, z },
  keysFound: 0,
  batteriesTaken: 0,
  isHidden: false,
  monsterState: MonsterState.PATROL,
  ...overrides,
});

describe('tutorial map', () => {
  it('has two keys, a battery, a bottle and a can, all reachable from the spawn', () => {
    expect(level.keys).toHaveLength(2);
    expect(level.batteries).toHaveLength(1);
    expect(level.throwables).toHaveLength(2);
    [...level.keys, ...level.batteries, ...level.throwables].forEach((cell) => expect(reachable(cell)).toBe(true));
  });

  it('lets the player walk everywhere, but keeps the first rooms out of the monster reach (vent)', () => {
    level.floorCells.forEach((cell) => expect(reachable(cell)).toBe(true));
    const monsterReach = (cell) => findPath(level, level.monsterSpawn, cell, isMonsterWalkable) !== null;
    expect(monsterReach({ x: 24, z: 7 })).toBe(true); // the lockers
    expect(monsterReach({ x: 3, z: 8 })).toBe(true); // the exit hall
    expect(monsterReach(level.spawn)).toBe(false); // it can never reach the wake room
  });

  it('names rooms that cover every floor cell except doorways and the vent', () => {
    const isWall = (x, z) => !isWalkable(level, x, z);
    level.floorCells
      .filter((cell) => roomAt(TUTORIAL_ROOMS, cell) === null)
      .forEach(({ x, z }) => {
        expect((isWall(x - 1, z) && isWall(x + 1, z)) || (isWall(x, z - 1) && isWall(x, z + 1))).toBe(true);
      });
  });

  it('puts every checkpoint on reachable floor', () => {
    TUTORIAL_STEPS.forEach(({ checkpoint }) => {
      expect(isWalkable(level, checkpoint.x, checkpoint.z)).toBe(true);
      expect(reachable(checkpoint)).toBe(true);
    });
  });
});

describe('Tutorial', () => {
  it('walks through every step in order as the player does what each one asks', () => {
    const tutorial = new Tutorial();
    expect(tutorial.update(at(2, 2))).toBe(true); // step 1 begins
    expect(tutorial.update(at(2, 2))).toBe(false);

    expect(tutorial.update(at(6, 2))).toBe(true); // into the hall
    expect(tutorial.update(at(10, 2))).toBe(false);
    expect(tutorial.update(at(14, 2))).toBe(true); // end of the hall
    expect(tutorial.update(at(18, 2))).toBe(true); // through the vent
    expect(tutorial.update(at(18, 2, { batteriesTaken: 1 }))).toBe(true);
    expect(tutorial.update(at(27, 3, { batteriesTaken: 1, keysFound: 1 }))).toBe(true);
    expect(tutorial.index).toBe(5);

    expect(tutorial.update(at(28, 6, { isHidden: true, monsterState: MonsterState.SEARCH }))).toBe(false);
    expect(tutorial.update(at(28, 6, { monsterState: MonsterState.PATROL }))).toBe(true); // it gave up
    expect(tutorial.update(at(5, 8))).toBe(true); // slipped into the exit hall

    expect(tutorial.update(at(3, 8))).toBe(false);
    tutorial.note('stunned');
    expect(tutorial.update(at(3, 8))).toBe(true);
    expect(tutorial.index).toBe(TUTORIAL_STEPS.length - 1); // the escape itself ends the run
  });

  it('only counts the hiding step once the player actually hid', () => {
    const tutorial = new Tutorial();
    tutorial.index = 5;
    tutorial.hasStarted = true;
    expect(tutorial.update(at(24, 8, { monsterState: MonsterState.PATROL }))).toBe(false);
  });

  it('forgets what happened in a step once the next one begins', () => {
    const tutorial = new Tutorial();
    tutorial.update(at(2, 2));
    tutorial.note('stunned');
    tutorial.update(at(6, 2));
    expect(tutorial.flags.size).toBe(0);
  });

  it('stages the monster for the hiding step, and replays the charge only on a retry of the last one', () => {
    const calls = [];
    const director = {
      sleep: () => calls.push('sleep'),
      place: () => calls.push('place'),
      investigate: () => calls.push('investigate'),
      guard: () => calls.push('guard'),
      charge: () => calls.push('charge'),
    };
    TUTORIAL_STEPS[5].setup(director, false);
    expect(calls).toEqual(['place', 'investigate']);

    calls.length = 0;
    TUTORIAL_STEPS.at(-1).setup(director, false);
    expect(calls).toEqual([]);
    TUTORIAL_STEPS.at(-1).setup(director, true);
    expect(calls).toEqual(['place', 'charge']);
  });
});

describe('Monster staging', () => {
  const target = (cell, overrides = {}) => {
    const { x, z } = cellToWorld(cell);
    return { position: new THREE.Vector3(x, 0, z), noiseRadius: 0, isCrouching: false, isLit: false, ...overrides };
  };

  it('does nothing while dormant, even next to a noisy player', () => {
    const monster = new Monster(level, () => 0.5);
    monster.setDormant(true);
    const start = monster.position.clone();
    const loud = target({ x: 11, z: 6 }, { noiseRadius: 12, isLit: true });
    for (let i = 0; i < 120; i++) expect(monster.update(DT, loud)).toBeNull();
    expect(monster.position.equals(start)).toBe(true);
    expect(monster.body.visible).toBe(false);
  });

  it('keeps its patrol inside the area it guards', () => {
    let seed = 7;
    const monster = new Monster(level, () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646);
    const area = { x0: 9, z0: 6, x1: 11, z1: 10 };
    monster.place({ x: 10, z: 8 });
    monster.setPatrolArea(area);
    const away = target({ x: 26, z: 2 }); // far away in the archive, unseen
    for (let i = 0; i < 60 * 30; i++) {
      monster.update(DT, away);
      const { x } = monster.position;
      expect(x).toBeGreaterThanOrEqual(cellToWorld({ x: area.x0, z: 0 }).x - 0.01);
      expect(x).toBeLessThanOrEqual(cellToWorld({ x: area.x1, z: 0 }).x + 0.01);
    }
  });

  it('roars in place before a staged charge', () => {
    const monster = new Monster(level, () => 0.5);
    monster.place({ x: 13, z: 8 });
    const player = target({ x: 3, z: 8 });
    monster.alert(player.position, 1);
    const start = monster.position.clone();
    for (let i = 0; i < 50; i++) monster.update(DT, player);
    expect(monster.position.distanceTo(start)).toBeLessThan(0.01);
    for (let i = 0; i < 60; i++) monster.update(DT, player);
    expect(monster.position.distanceTo(start)).toBeGreaterThan(1);
  });
});
