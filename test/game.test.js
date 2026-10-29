import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { parseLevel, cellToWorld, noisyFloorAt } from '../src/level/level.js';
import { Game, GameState } from '../src/core/game.js';
import { Input } from '../src/core/input.js';
import { Tutorial } from '../src/core/tutorial.js';
import { DIFFICULTIES } from '../src/core/difficulty.js';
import { STORY_NOTES } from '../src/core/story.js';
import { KEY_COUNT } from '../src/level/scatter.js';
import { Player } from '../src/player/player.js';
import { Flashlight } from '../src/player/flashlight.js';
import { Monster, MonsterState } from '../src/monster/monster.js';
import { createPickups, PickupType } from '../src/items/pickups.js';
import { createDoors } from '../src/world/doors.js';
import { createRadios } from '../src/world/radios.js';

// Two keys, a door between two rooms, glass and boards below the spawn, a radio next to the monster.
const MAP = ['#######', '#PK#K.#', 'E..D.M#', '#GW#R.#', '#######'];
// A battery and three throwables (bottle, can, bottle) next to the spawn, and a second battery.
const BAG_MAP = ['########', '#PBOOOB#', 'E.....M#', '########'];
const DT = 1 / 60;

/** Takes any call and does nothing: the HUD, the sound and the arms play no part in the rules. */
const inert = () => new Proxy({}, { get: () => () => {} });

const at = (cell) => {
  const { x, z } = cellToWorld(cell);
  return new THREE.Vector3(x, 0, z);
};

/** A Game on MAP with the real rules, player, monster, doors, radios and pickups. */
function setup({ tutorial = null, map = MAP, hud = inert() } = {}) {
  const level = parseLevel(map);
  const scene = new THREE.Scene();
  const colliders = [];
  const camera = new THREE.PerspectiveCamera();
  const events = new EventTarget();
  const input = new Input(events);
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
    hud,
    tutorial,
  });
  return { game, level, player, monster, world, input, events };
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

describe('Game: the story', () => {
  it('has one journal page for every key of a real run', () => {
    expect(STORY_NOTES).toHaveLength(KEY_COUNT);
  });

  it('reveals the journal one page per key, in order, whichever key is found first', () => {
    const showNote = vi.fn();
    const { game } = setup({ hud: new Proxy({ showNote }, { get: (target, name) => target[name] ?? (() => {}) }) });
    const [first, second] = game.pickups.items.filter((item) => item.type === PickupType.KEY);
    game.pickUp(second);
    game.pickUp(first);
    expect(showNote.mock.calls.map(([note]) => note)).toEqual([STORY_NOTES[0], STORY_NOTES[1]]);
  });

  it('keeps the journal out of the tutorial', () => {
    const showNote = vi.fn();
    const tutorial = new Tutorial(
      [],
      [{ text: 'Test', checkpoint: { x: 1, z: 1 }, setup: () => {}, isDone: () => false }],
    );
    const { game } = setup({
      tutorial,
      hud: new Proxy({ showNote }, { get: (target, name) => target[name] ?? (() => {}) }),
    });
    game.pickUp(game.pickups.items.find((item) => item.type === PickupType.KEY));
    expect(showNote).not.toHaveBeenCalled();
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

describe('Game: the bag', () => {
  const bagSetup = () => {
    const context = setup({ map: BAG_MAP });
    const items = context.game.pickups.items;
    const [battery, spareBattery] = items.filter((item) => item.type === PickupType.BATTERY);
    const [bottle, can, secondBottle] = items.filter((item) => item.type !== PickupType.BATTERY);
    return { ...context, battery, spareBattery, bottle, can, secondBottle };
  };
  const press = (events, code) => {
    events.dispatchEvent(Object.assign(new Event('keydown'), { code }));
    events.dispatchEvent(Object.assign(new Event('keyup'), { code }));
  };

  it('puts a picked-up battery in the bag instead of recharging, and G puts it in the flashlight', () => {
    const { game, battery } = bagSetup();
    game.flashlight.battery = 0.3;
    game.pickUp(battery);
    expect(game.flashlight.battery).toBe(0.3);
    expect(game.inventory.selectedItem).toBe(battery);

    game.useSelected();
    expect(game.flashlight.battery).toBeCloseTo(0.75, 5);
    expect(game.inventory.selectedItem).toBeNull();
  });

  it('keeps the spare battery while the flashlight is still full', () => {
    const { game, battery } = bagSetup();
    game.pickUp(battery);
    game.useSelected();
    expect(game.inventory.selectedItem).toBe(battery);
  });

  it('drops the selected item just in front of the feet, where it can be picked up again', () => {
    const { game, player, bottle } = bagSetup();
    game.pickUp(bottle);
    expect(bottle.isTaken).toBe(true);

    game.dropSelected();
    expect(game.inventory.slots.every((slot) => slot === null)).toBe(true);
    expect(bottle.isTaken).toBe(false);
    const offset = Math.hypot(bottle.mesh.position.x - player.position.x, bottle.mesh.position.z - player.position.z);
    expect(offset).toBeCloseTo(0.3, 5);
  });

  it('with a full bag, offers to swap the selected item for the one looked at', () => {
    const { game, battery, bottle, can, secondBottle, spareBattery } = bagSetup();
    [battery, bottle, can, secondBottle].forEach((item) => game.pickUp(item));
    expect(game.inventory.isFull).toBe(true);
    const spot = { x: spareBattery.mesh.position.x, z: spareBattery.mesh.position.z };
    vi.spyOn(game.pickups, 'findTarget').mockReturnValue(spareBattery);

    const action = game.findInteraction();
    expect(action?.prompt).toMatch(/Swap your bottle for the battery/);
    action.run();
    expect(game.inventory.selectedItem).toBe(spareBattery);
    expect(secondBottle.isTaken).toBe(false);
    expect(secondBottle.mesh.position.x).toBeCloseTo(spot.x, 5);
    expect(secondBottle.mesh.position.z).toBeCloseTo(spot.z, 5);
  });

  it('never puts keys in the bag', () => {
    const { game } = setup();
    const [key] = game.pickups.items;
    game.pickUp(key);
    expect(game.keysFound).toBe(1);
    expect(game.inventory.slots.every((slot) => slot === null)).toBe(true);
  });

  it('picks a slot with the number keys and the wheel, and throws what it holds with G', () => {
    const { game, input, events, bottle, can } = bagSetup();
    game.pickUp(bottle);
    game.pickUp(can);
    press(events, 'Digit1');
    game.handleItemInput();
    expect(game.inventory.selectedItem).toBe(bottle);
    input.endFrame();

    events.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: 100 }));
    game.handleItemInput();
    expect(game.inventory.selectedItem).toBe(can);
    input.endFrame();

    press(events, 'KeyG');
    game.handleItemInput();
    expect(game.inventory.selectedItem).toBeNull();
    expect(game.throwing.flying.map((flight) => flight.item)).toEqual([can]);
  });
});
