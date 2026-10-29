import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { parseLevel, cellToWorld, noisyFloorAt } from '../src/level/level.js';
import { Game, GameState } from '../src/core/game.js';
import { Input } from '../src/core/input.js';
import { Tutorial } from '../src/core/tutorial.js';
import { DIFFICULTIES } from '../src/core/difficulty.js';
import { Player } from '../src/player/player.js';
import { Flashlight } from '../src/player/flashlight.js';
import { Monster, MonsterState } from '../src/monster/monster.js';
import { createPickups, PickupType } from '../src/items/pickups.js';
import { createDoors } from '../src/world/doors.js';
import { createRadios } from '../src/world/radios.js';

// Two keys, a door between two rooms, glass and boards below the spawn, a radio next to the monster.
const MAP = ['#######', '#PK#K.#', 'E..D.M#', '#GW#R.#', '#######'];
const DT = 1 / 60;

/** Takes any call and does nothing: the HUD, the sound and the arms play no part in the rules. */
const inert = () => new Proxy({}, { get: () => () => {} });

const at = (cell) => {
  const { x, z } = cellToWorld(cell);
  return new THREE.Vector3(x, 0, z);
};

/** A Game on MAP with the real rules, player, monster, doors, radios and pickups. */
function setup({ tutorial = null } = {}) {
  const level = parseLevel(MAP);
  const scene = new THREE.Scene();
  const colliders = [];
  const camera = new THREE.PerspectiveCamera();
  const input = new Input(new EventTarget());
  const player = new Player(camera, colliders, input, at(level.spawn));
  const monster = new Monster(level, () => 0.5);
  const world = {
    scene,
    colliders,
    lockers: { findNear: () => null },
    doors: createDoors(scene, colliders, level),
    radios: createRadios(scene, colliders, level),
    update: () => {},
    openExit: vi.fn(),
  };
  const game = new Game({
    level,
    camera,
    input,
    player,
    viewModel: inert(),
    flashlight: new Flashlight(() => 0.5),
    monster,
    pickups: createPickups(scene, level),
    world,
    audio: inert(),
    hud: inert(),
    tutorial,
  });
  return { game, level, player, monster, world, input };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Game: keys and the exit', () => {
  it('opens the exit once every key is found, and the monster comes running', () => {
    const { game, world, monster } = setup();
    const [first, last] = game.pickups.items.filter((item) => item.type === PickupType.KEY);
    game.pickUp(first);
    expect(game.isExitOpen).toBe(false);

    game.pickUp(last);
    expect(game.keysFound).toBe(2);
    expect(game.isExitOpen).toBe(true);
    expect(world.openExit).toHaveBeenCalledOnce();
    expect(monster.state).toBe(MonsterState.CHASE);
  });

  it('wins only when the player walks into the exit after it opened', () => {
    vi.stubGlobal('document', { exitPointerLock: vi.fn() });
    const { game, player, level } = setup();
    player.position.copy(at(level.exit));
    game.checkEscape();
    expect(game.state).toBe(GameState.PLAYING); // still locked

    game.openExit();
    game.checkEscape();
    expect(game.state).toBe(GameState.WON);
    expect(player.enabled).toBe(false);
  });
});

describe('Game: doors, radios and noisy floors', () => {
  it('will not shut a door on the player standing in the doorway', () => {
    const { game, player, world } = setup();
    const [door] = world.doors.doors;
    player.position.set(door.position.x, 0, door.position.z + 1.1); // off to the side, inside the doorway
    game.useDoor(door);
    expect(door.isOpen).toBe(true);

    player.position.set(door.position.x - 1.5, 0, door.position.z);
    game.useDoor(door);
    expect(door.isOpen).toBe(false);
    expect(world.colliders).toContain(door.collider);
  });

  it('lets the monster force a closed door on its path, which then stays jammed open', () => {
    const { game, player, monster, world } = setup();
    const [door] = world.doors.doors;
    world.doors.setOpen(door, false);
    monster.position.set(door.position.x + 1.5, 0, door.position.z);
    monster.path = [door.cell, { x: 2, z: 2 }];
    game.updateMonsterAtDoors();
    expect(door.isOpen).toBe(true);
    expect(monster.holdTimer).toBeGreaterThan(0);

    player.position.set(door.position.x - 1.5, 0, door.position.z);
    const action = game.findInteraction();
    expect(action?.prompt).toMatch(/jammed/);
    expect(action?.run).toBeUndefined(); // no shutting it in its face again and again
  });

  it('lures the monster to a radio that is switched on', () => {
    const { game, monster, world } = setup();
    const [radio] = world.radios.radios;
    game.useRadio(radio);
    game.updateRadios(DT);
    expect(monster.state).toBe(MonsterState.SEARCH);
    expect(monster.lastKnown.distanceTo(radio.position)).toBeLessThan(0.01);
  });

  it('lets the monster hear a careless step on glass, but not a careful one', () => {
    const { game, level, player, monster } = setup();
    const hear = vi.spyOn(monster, 'hearNoise');
    player.position.copy(at({ x: 1, z: 3 }));
    game.stepOnNoisyFloor(true);
    expect(hear).not.toHaveBeenCalled();

    game.stepOnNoisyFloor(false);
    expect(hear).toHaveBeenCalledWith(player.position, noisyFloorAt(level, 1, 3)?.radius);
  });
});

describe('Game: caught', () => {
  it('grabs the player it catches in a real run', () => {
    const { game, monster } = setup();
    vi.spyOn(monster, 'update').mockReturnValue('caught');
    game.updateMonster(DT);
    expect(game.state).toBe(GameState.GRABBED);
    expect(game.health).toBe(80);
  });

  it('lets the player break free by mashing Space, which stuns it', () => {
    const { game, input, monster } = setup();
    game.startGrab();
    for (let i = 0; i < 60 && game.state === GameState.GRABBED; i++) {
      input.pressed.add('Space');
      game.updateGrab(DT);
      input.endFrame();
    }
    expect(game.state).toBe(GameState.PLAYING);
    expect(monster.state).toBe(MonsterState.STUNNED);
  });

  it('kills the player who does not break free in time', () => {
    vi.stubGlobal('document', { exitPointerLock: vi.fn() });
    const { game } = setup();
    game.startGrab();
    for (let t = 0; t < 6 && game.state === GameState.GRABBED; t += DT) game.updateGrab(DT);
    expect(game.state).toBe(GameState.DYING);

    for (let t = 0; t < 2.1 && game.state === GameState.DYING; t += DT) game.updateJumpscare(DT);
    expect(game.state).toBe(GameState.DEAD);
  });

  it('in the tutorial, sends the player back to the checkpoint instead, on Easy', () => {
    const setupStep = vi.fn();
    const tutorial = new Tutorial(
      [],
      [{ text: 'Test', checkpoint: { x: 1, z: 1 }, setup: setupStep, isDone: () => false }],
    );
    const { game, player, monster } = setup({ tutorial });
    game.setDifficulty(DIFFICULTIES.hard);
    expect(game.difficulty).toBe(DIFFICULTIES.easy);

    player.position.copy(at({ x: 4, z: 2 }));
    game.health = 30;
    vi.spyOn(monster, 'update').mockReturnValue('caught');
    game.updateMonster(DT);
    expect(game.state).toBe(GameState.PLAYING);
    expect(player.position.distanceTo(at({ x: 1, z: 1 }))).toBeLessThan(0.01);
    expect(game.health).toBe(100);
    expect(setupStep).toHaveBeenCalledWith(game.director, true);
  });
});

describe('Game: the frame loop', () => {
  it('moves the player only while unpaused', () => {
    const { game, player, input } = setup();
    const start = player.position.clone();
    input.keys.add('KeyS'); // backward: away from the wall north of the spawn
    for (let i = 0; i < 30; i++) game.update(DT, i * DT);
    expect(player.position.distanceTo(start)).toBe(0); // the title screen is up

    game.setPaused(false);
    for (let i = 0; i < 30; i++) game.update(DT, i * DT);
    expect(player.position.z).toBeGreaterThan(start.z + 0.3);
  });
});
