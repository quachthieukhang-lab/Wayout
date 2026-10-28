import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { parseLevel, cellToWorld } from '../src/level/level.js';
import { Monster, MonsterState } from '../src/monster/monster.js';
import { Flashlight } from '../src/player/flashlight.js';
import { DIFFICULTIES } from '../src/core/difficulty.js';

const DT = 1 / 60;
const ROOM = ['#########', '#P......#', '#.......#', '#...M...E', '#.......#', '#.......#', '#########'];

/** Deterministic pseudo-random sequence. */
function seededRng(seed = 1) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function setup() {
  const level = parseLevel(ROOM);
  const monster = new Monster(level, seededRng());
  const at = (x, z) => {
    const w = cellToWorld({ x, z });
    return new THREE.Vector3(w.x, 0, w.z);
  };
  const target = (position, overrides = {}) => ({
    position,
    noiseRadius: 0,
    isCrouching: false,
    isLit: false,
    ...overrides,
  });
  return { level, monster, at, target };
}

describe('Monster', () => {
  it('hears a sprinting player behind it and, after a moment of suspicion, starts chasing', () => {
    const { monster, at, target } = setup();
    const sprinter = target(at(4, 1), { noiseRadius: 15 });
    expect(monster.update(DT, sprinter)).toBeNull(); // not instant

    let event = null;
    for (let i = 0; i < 60 && event !== 'spotted'; i++) event = monster.update(DT, sprinter);
    expect(event).toBe('spotted');
    expect(monster.state).toBe(MonsterState.CHASE);
  });

  it('only investigates a brief glimpse and calms down when the player hides', () => {
    const { monster, at, target } = setup();
    const ahead = target(at(4, 5), { isLit: true });
    for (let i = 0; i < 20; i++) monster.update(DT, ahead); // ~0.33 s, not long enough to be sure
    expect(monster.state).not.toBe(MonsterState.CHASE);

    const hidden = target(at(1, 1), { isCrouching: true });
    for (let i = 0; i < 60 * 3; i++) monster.update(DT, hidden);
    expect(monster.awareness).toBe(0);
    expect(monster.state).not.toBe(MonsterState.CHASE);
  });

  it('barely hears a sprinting player through a wall', () => {
    const level = parseLevel(['#######', '#..#..#', '#P.#M.#', '#..#..E', '#######']);
    const monster = new Monster(level, seededRng());
    const behindWall = cellToWorld({ x: 2, z: 2 }); // 6 m away, wall cell in between
    const target = {
      position: new THREE.Vector3(behindWall.x, 0, behindWall.z),
      noiseRadius: 15,
      isCrouching: false,
      isLit: true,
    };
    expect(monster.update(DT, target)).toBeNull();
    expect(monster.state).toBe(MonsterState.PATROL);
  });

  it('does not notice a quiet player behind it, even with the flashlight on', () => {
    const { monster, at, target } = setup();
    // The monster faces +Z (yaw 0); the player stands at -Z.
    expect(monster.update(DT, target(at(4, 1), { isLit: true }))).toBeNull();
    expect(monster.state).toBe(MonsterState.PATROL);
  });

  it('sees farther when the player has the flashlight on', () => {
    const { target } = setup();
    const corridor = parseLevel([
      '#####################',
      '#M..................E',
      '#P###################',
      '#####################',
    ]);
    const monster = new Monster(corridor, seededRng());
    monster.yaw = Math.PI / 2; // facing +X, down the corridor
    const ahead = monster.position.clone().add(new THREE.Vector3(12, 0, 0));
    expect(monster.canSee(target(ahead), 12)).toBe(false);
    expect(monster.canSee(target(ahead, { isLit: true }), 12)).toBe(true);
    expect(monster.canSee(target(ahead, { isLit: true, isCrouching: true }), 12)).toBe(false);
  });

  it('cannot sense a player hiding in a locker unless it saw them climb in', () => {
    const { monster, at, target } = setup();
    const hidden = target(at(4, 4), { isHidden: true, isLit: true, noiseRadius: 12 }); // right in front of it
    for (let i = 0; i < 60 * 3; i++) expect(monster.update(DT, hidden)).toBeNull();
    expect(monster.state).not.toBe(MonsterState.CHASE);
  });

  it('drags out a player it watched hide', () => {
    const { monster, at, target } = setup();
    monster.alert(at(4, 5));
    const hiding = target(at(4, 5), { isHidden: true });
    let event = null;
    for (let i = 0; i < 60 * 6 && event !== 'caught'; i++) event = monster.update(DT, hiding);
    expect(monster.sawHiding).toBe(true);
    expect(event).toBe('caught');
  });

  it('cannot see a crouched player behind a bed, only a standing one', () => {
    const level = parseLevel(['#########', '#M..T..P#', '#.......E', '#########']);
    const monster = new Monster(level, seededRng());
    monster.yaw = Math.PI / 2; // facing +X, toward the bed
    const behindBed = monster.position.clone().add(new THREE.Vector3(12, 0, 0));
    const player = { position: behindBed, noiseRadius: 0, isCrouching: false, isLit: true };
    expect(monster.canSee(player, 12)).toBe(true);
    expect(monster.canSee({ ...player, isCrouching: true, isLit: false }, 4)).toBe(false);
  });

  it('chases down and catches a noisy player', () => {
    const { monster, at, target } = setup();
    const player = target(at(4, 5), { isLit: true, noiseRadius: 7 }); // heard even while it looks away
    let event = null;
    for (let i = 0; i < 60 * 8 && event !== 'caught'; i++) event = monster.update(DT, player);
    expect(event).toBe('caught');
  });

  it('cannot move or catch while stunned, then goes searching', () => {
    const { monster, at, target } = setup();
    const start = monster.position.clone();
    monster.stun(1);
    const touching = target(monster.position.clone(), { noiseRadius: 15 });
    for (let i = 0; i < 30; i++) expect(monster.update(DT, touching)).toBeNull();
    expect(monster.position.equals(start)).toBe(true);

    for (let i = 0; i < 40; i++) monster.update(DT, target(at(1, 1)));
    expect(monster.state).not.toBe(MonsterState.STUNNED);
  });

  it('searches where it lost the player, then goes back to patrolling', () => {
    const { monster, at, target } = setup();
    const hidden = target(at(1, 1), { isCrouching: true });
    monster.alert(at(7, 5));

    const seen = new Set();
    for (let i = 0; i < 60 * 20; i++) {
      monster.update(DT, hidden);
      seen.add(monster.state);
      if (seen.has(MonsterState.SEARCH) && monster.state === MonsterState.PATROL) break;
    }
    expect(seen.has(MonsterState.SEARCH)).toBe(true);
    expect(monster.state).toBe(MonsterState.PATROL);
  });
});

describe('Monster and thrown noises', () => {
  it('walks over to check a bottle smashing nearby, without chasing anyone', () => {
    const { monster, at } = setup();
    expect(monster.hearNoise(at(7, 1), 20)).toBe(true);
    expect(monster.state).toBe(MonsterState.SEARCH);
    expect(monster.lastKnown.x).toBeCloseTo(at(7, 1).x);
  });

  it('does not hear a can through walls when it is too far, nor while stunned', () => {
    const level = parseLevel(['#########', '#M..#..P#', '#...#...E', '#########']);
    const monster = new Monster(level, seededRng());
    const behindWall = cellToWorld({ x: 7, z: 1 }); // 18 m away, through a wall
    expect(monster.hearNoise(behindWall, 13)).toBe(false);
    expect(monster.state).toBe(MonsterState.PATROL);

    const { monster: stunned, at } = setup();
    stunned.stun(2);
    expect(stunned.hearNoise(at(5, 3), 20)).toBe(false);
  });

  it('mid-chase takes the bait only after it has lost sight of the player', () => {
    const { monster, at, target } = setup();
    monster.alert(at(4, 5));
    monster.update(DT, target(at(4, 4), { isLit: true })); // sees the player right in front
    expect(monster.isPerceiving).toBe(true);
    expect(monster.hearNoise(at(1, 1), 20)).toBe(false);

    monster.update(DT, target(at(1, 5), { isCrouching: true })); // the player slipped away, out of its sight
    expect(monster.isPerceiving).toBe(false);
    expect(monster.hearNoise(at(1, 1), 20)).toBe(true);
    expect(monster.lastKnown.x).toBeCloseTo(at(1, 1).x);
  });
});

describe('Difficulty', () => {
  /** How far it charges in half a second down a straight row toward a noise. */
  const chargeDistance = (difficulty) => {
    const { monster, at, target } = setup();
    monster.setDifficulty(difficulty);
    monster.alert(at(7, 3));
    const start = monster.position.clone();
    for (let i = 0; i < 30; i++) monster.update(DT, target(at(1, 1), { isCrouching: true }));
    return monster.position.distanceTo(start);
  };

  it('makes the monster faster on Hard and slower on Easy', () => {
    const normal = chargeDistance(DIFFICULTIES.normal);
    expect(normal).toBeGreaterThan(1);
    expect(chargeDistance(DIFFICULTIES.hard)).toBeCloseTo(normal * DIFFICULTIES.hard.monsterSpeed, 1);
    expect(chargeDistance(DIFFICULTIES.easy)).toBeCloseTo(normal * DIFFICULTIES.easy.monsterSpeed, 1);
  });

  it('lets it hear farther on Hard: a walker at 6 m is noticed on Hard, not on Easy', () => {
    const hears = (difficulty) => {
      const { monster, at, target } = setup();
      monster.setDifficulty(difficulty);
      let event = null;
      for (let i = 0; i < 60 && event !== 'spotted'; i++)
        event = monster.update(DT, target(at(4, 1), { noiseRadius: 5 }));
      return monster.state !== MonsterState.PATROL || event === 'spotted';
    };
    expect(hears(DIFFICULTIES.hard)).toBe(true);
    expect(hears(DIFFICULTIES.easy)).toBe(false);
  });

  it('drains the flashlight faster on Hard', () => {
    const drained = (difficulty) => {
      const light = new Flashlight(() => 1);
      light.drainScale = difficulty.batteryDrain;
      light.update(30);
      return 1 - light.battery;
    };
    expect(drained(DIFFICULTIES.hard)).toBeGreaterThan(drained(DIFFICULTIES.normal));
    expect(drained(DIFFICULTIES.easy)).toBeLessThan(drained(DIFFICULTIES.normal));
  });
});

describe('Flashlight', () => {
  it('drains the battery only while on and turns off when empty', () => {
    const light = new Flashlight(() => 1);
    light.update(10);
    expect(light.battery).toBeLessThan(1);

    light.toggle();
    const charge = light.battery;
    light.update(10);
    expect(light.battery).toBe(charge);
    expect(light.light.intensity).toBe(0);

    light.toggle();
    light.update(1000);
    expect(light.battery).toBe(0);
    expect(light.isOn).toBe(false);
    expect(light.toggle()).toBe(false);
  });

  it('fires a flash burst that costs battery and then cools down', () => {
    const light = new Flashlight(() => 1);
    expect(light.burst()).toBe(true);
    expect(light.battery).toBeCloseTo(0.8, 5);
    expect(light.burst()).toBe(false); // cooling down
    light.update(10);
    expect(light.burst()).toBe(true);

    light.toggle(); // off
    light.update(10);
    expect(light.burst()).toBe(false);
  });

  it('can be recharged up to full', () => {
    const light = new Flashlight(() => 1);
    light.battery = 0.5;
    light.recharge(0.8);
    expect(light.battery).toBe(1);
  });
});
