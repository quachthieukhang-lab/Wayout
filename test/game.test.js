import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { parseLevel, cellToWorld, noisyFloorAt } from '../src/level/level.js';
import { Game, GameState } from '../src/core/game.js';
import { Input } from '../src/core/input.js';
import { Tutorial } from '../src/core/tutorial.js';
import { DIFFICULTIES } from '../src/core/difficulty.js';
import { STORY_NOTES } from '../src/core/story.js';
import { PAGE_COUNT } from '../src/level/scatter.js';
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
function setup({ tutorial = null, map = MAP, hud = inert(), extras = {}, recordBook = null } = {}) {
  const level = { ...parseLevel(map), ...extras };
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
    setPower: vi.fn(),
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
    recordBook,
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
  it('has one journal page for every page scattered in a real run', () => {
    expect(STORY_NOTES).toHaveLength(PAGE_COUNT);
  });

  it('reveals the journal one page per page found, in order, and none for keys', () => {
    const showNote = vi.fn();
    const { game } = setup({ hud: new Proxy({ showNote }, { get: (target, name) => target[name] ?? (() => {}) }) });
    game.pickUp(game.pickups.items.find((item) => item.type === PickupType.KEY));
    expect(showNote).not.toHaveBeenCalled();
    game.revealNote(STORY_NOTES[game.pagesFound++]);
    expect(showNote).toHaveBeenCalledWith(STORY_NOTES[0]);
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
    expect(game.bag.inventory.selectedItem).toBe(battery);

    game.bag.useSelected();
    expect(game.flashlight.battery).toBeCloseTo(0.75, 5);
    expect(game.bag.inventory.selectedItem).toBeNull();
  });

  it('keeps the spare battery while the flashlight is still full', () => {
    const { game, battery } = bagSetup();
    game.pickUp(battery);
    game.bag.useSelected();
    expect(game.bag.inventory.selectedItem).toBe(battery);
  });

  it('drops the selected item just in front of the feet, where it can be picked up again', () => {
    const { game, player, bottle } = bagSetup();
    game.pickUp(bottle);
    expect(bottle.isTaken).toBe(true);

    game.bag.dropSelected();
    expect(game.bag.inventory.slots.every((slot) => slot === null)).toBe(true);
    expect(bottle.isTaken).toBe(false);
    const offset = Math.hypot(bottle.mesh.position.x - player.position.x, bottle.mesh.position.z - player.position.z);
    expect(offset).toBeCloseTo(0.3, 5);
  });

  it('with a full bag, offers to swap the selected item for the one looked at', () => {
    const { game, battery, bottle, can, secondBottle, spareBattery } = bagSetup();
    [battery, bottle, can, secondBottle].forEach((item) => game.pickUp(item));
    expect(game.bag.inventory.isFull).toBe(true);
    const spot = { x: spareBattery.mesh.position.x, z: spareBattery.mesh.position.z };
    vi.spyOn(game.pickups, 'findTarget').mockReturnValue(spareBattery);

    const action = game.findInteraction();
    expect(action?.prompt).toMatch(/Swap your bottle for the battery/);
    action.run();
    expect(game.bag.inventory.selectedItem).toBe(spareBattery);
    expect(secondBottle.isTaken).toBe(false);
    expect(secondBottle.mesh.position.x).toBeCloseTo(spot.x, 5);
    expect(secondBottle.mesh.position.z).toBeCloseTo(spot.z, 5);
  });

  it('never puts keys in the bag', () => {
    const { game } = setup();
    const [key] = game.pickups.items;
    game.pickUp(key);
    expect(game.keysFound).toBe(1);
    expect(game.bag.inventory.slots.every((slot) => slot === null)).toBe(true);
  });

  it('picks a slot with the number keys and the wheel, and throws what it holds with G', () => {
    const { game, input, events, bottle, can } = bagSetup();
    game.pickUp(bottle);
    game.pickUp(can);
    press(events, 'Digit1');
    game.bag.handleInput(false);
    expect(game.bag.inventory.selectedItem).toBe(bottle);
    input.endFrame();

    events.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: 100 }));
    game.bag.handleInput(false);
    expect(game.bag.inventory.selectedItem).toBe(can);
    input.endFrame();

    press(events, 'KeyG');
    game.bag.handleInput(false);
    expect(game.bag.inventory.selectedItem).toBeNull();
    expect(game.bag.throwing.flying.map((flight) => flight.item)).toEqual([can]);
  });
});

describe('Game: supplies, the journal, tapes and the floor plan', () => {
  // Spare cells next to the spawn hold the new items.
  const extras = {
    bandages: [{ x: 4, z: 1 }],
    flares: [{ x: 5, z: 1 }],
    pages: [{ x: 4, z: 2 }],
    tapes: [{ x: 5, z: 2 }],
    maps: [{ x: 1, z: 2 }],
  };
  const withHud = (spies) => new Proxy(spies, { get: (target, name) => target[name] ?? (() => {}) });
  const find = (game, type) => game.pickups.items.find((item) => item.type === type);

  it('puts bandages and flares in the bag; a bandage heals only a hurt player', () => {
    const { game } = setup({ extras });
    const bandage = find(game, PickupType.BANDAGE);
    game.pickUp(bandage);
    expect(game.bag.inventory.selectedItem).toBe(bandage);
    game.bag.useSelected();
    expect(game.bag.inventory.selectedItem).toBe(bandage); // not hurt: kept

    game.health = 30;
    game.bag.useSelected();
    expect(game.health).toBe(75);
    expect(game.bag.inventory.selectedItem).toBeNull();
  });

  it('lights a flare as it is thrown; where it lands it lures the monster', () => {
    const { game, monster } = setup({ extras });
    const flare = find(game, PickupType.FLARE);
    game.pickUp(flare);
    game.bag.useSelected();
    expect(game.bag.flares.burning?.item).toBe(flare);
    expect(game.bag.throwing.flying.map((flight) => flight.item)).toEqual([flare]);

    const hear = vi.spyOn(monster, 'hearNoise');
    game.bag.updateFlares(DT);
    expect(hear).toHaveBeenCalledWith(flare.mesh.position, expect.any(Number), true);
  });

  it('dazzles the monster that walks up to a burning flare', () => {
    const { game, monster } = setup({ extras });
    const flare = find(game, PickupType.FLARE);
    game.pickUp(flare);
    game.bag.useSelected();
    monster.position.copy(flare.mesh.position);
    game.bag.updateFlares(DT);
    expect(monster.state).toBe(MonsterState.STUNNED);
  });

  it('reads journal pages in order and counts them, and plays a tape out loud', () => {
    const showNote = vi.fn();
    const { game, monster } = setup({ extras, hud: withHud({ showNote }) });
    game.pickUp(find(game, PickupType.PAGE));
    expect(game.pagesFound).toBe(1);
    expect(showNote).toHaveBeenLastCalledWith(STORY_NOTES[0]);

    const hear = vi.spyOn(monster, 'hearNoise');
    game.pickUp(find(game, PickupType.TAPE));
    expect(showNote.mock.lastCall?.[0].kind).toBe('tape');
    expect(hear).toHaveBeenCalled(); // the monster might hear it too
  });

  it('opens the floor plan with M only once it is found', () => {
    const toast = vi.fn();
    const setMap = vi.fn();
    const { game, events } = setup({ extras, hud: withHud({ toast, setMap }) });
    const pressM = () => {
      events.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyM' }));
      events.dispatchEvent(Object.assign(new Event('keyup'), { code: 'KeyM' }));
      game.updateMap();
      game.input.endFrame();
    };
    pressM();
    expect(game.isMapOpen).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(expect.stringMatching(/no map/));

    game.pickUp(find(game, PickupType.MAP));
    pressM();
    expect(game.isMapOpen).toBe(true);
    expect(setMap).toHaveBeenLastCalledWith(expect.objectContaining({ isExitOpen: false }));
  });
});

describe('Game: the end of a run', () => {
  it('records an escape, picks the ending by the pages read, and shows the time', () => {
    vi.stubGlobal('document', { exitPointerLock: vi.fn() });
    const showEnd = vi.fn();
    const record = vi.fn(() => ({ isNewBest: true, previousBest: null, records: { bestTimes: { normal: 42 } } }));
    const hud = new Proxy({ showEnd }, { get: (target, name) => target[name] ?? (() => {}) });
    const { game, player, level } = setup({ hud, recordBook: { records: null, record } });
    game.runTime = 42;
    game.openExit();
    player.position.copy(at(level.exit));
    game.checkEscape();

    expect(record).toHaveBeenCalledWith(expect.objectContaining({ isWin: true, time: 42, ending: 'blind' }));
    const [[isWin, , extras]] = showEnd.mock.calls;
    expect(isWin).toBe(true);
    expect(extras.title).toBe('YOU RAN'); // no journal pages read
    expect(extras.badge).toMatch(/best/i);
    expect(extras.stats).toContainEqual(['Escaped in', '0:42']);
  });

  it('after a death, shows how long the player lasted and a tip for next time', () => {
    vi.stubGlobal('document', { exitPointerLock: vi.fn() });
    const showEnd = vi.fn();
    const hud = new Proxy({ showEnd }, { get: (target, name) => target[name] ?? (() => {}) });
    const { game, monster } = setup({ hud });
    game.runTime = 95;
    vi.spyOn(monster, 'update').mockReturnValue('caught');
    game.updateMonster(DT);
    for (let t = 0; t < 6 && game.state === GameState.GRABBED; t += DT) game.updateGrab(DT);
    for (let t = 0; t < 2.1 && game.state === GameState.DYING; t += DT) game.updateJumpscare(DT);

    const [[isWin, , extras]] = showEnd.mock.calls;
    expect(isWin).toBe(false);
    expect(extras.stats).toContainEqual(['Survived', '1:35']);
    expect(extras.tip).toMatch(/Space/); // it never mashed Space
  });
});
