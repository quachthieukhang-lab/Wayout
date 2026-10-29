import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { parseLevel, cellToWorld } from '../src/level/level.js';
import { EventClock, WorldEvents, WorldEvent, BLACKOUT_TIME } from '../src/core/events.js';
import { Flares, FLARE_BURN_TIME, FLARE_DAZZLE_DISTANCE } from '../src/items/flares.js';
import { createDoors } from '../src/world/doors.js';
import { Monster, MonsterState } from '../src/monster/monster.js';

// A long hall with a door far from the spawn.
const HALL = ['###########', '#P......D.#', '#.......#ME', '###########'];

/** Calls back with the next value of a fixed list, then repeats the last. */
const sequence = (...values) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};

function setupEvents(rng = () => 0) {
  const level = parseLevel(HALL);
  const scene = new THREE.Scene();
  const colliders = [];
  const spawn = cellToWorld(level.spawn);
  const targets = {
    world: { setPower: vi.fn(), doors: createDoors(scene, colliders, level) },
    monster: new Monster(level, () => 0.5),
    player: { position: new THREE.Vector3(spawn.x, 0, spawn.z), yaw: 0 },
    audio: { powerDown: vi.fn(), powerUp: vi.fn(), doorSlam: vi.fn(), phantom: vi.fn() },
    hud: { toast: vi.fn() },
  };
  return { targets, events: new WorldEvents(targets, rng), level };
}

describe('EventClock', () => {
  it('waits at least a minute before the first event, then picks one', () => {
    const clock = new EventClock(() => 0);
    expect(clock.update(59, { isBusy: false, keysFound: 0 })).toBeNull();
    expect(clock.update(2, { isBusy: false, keysFound: 0 })).not.toBeNull();
  });

  it('holds off while the player is busy, and never repeats an event back to back', () => {
    const clock = new EventClock(() => 0);
    expect(clock.update(200, { isBusy: true, keysFound: 0 })).toBeNull();
    const first = clock.update(200, { isBusy: false, keysFound: 0 });
    const second = clock.update(200, { isBusy: false, keysFound: 0 });
    expect(second).not.toBe(first);
  });

  it('comes sooner the more keys are found', () => {
    const calm = new EventClock(() => 0);
    const restless = new EventClock(() => 0);
    expect(calm.update(50, { isBusy: false, keysFound: 0 })).toBeNull();
    expect(restless.update(50, { isBusy: false, keysFound: 4 })).not.toBeNull();
  });
});

describe('WorldEvents', () => {
  it('cuts the power for a while, then brings it back', () => {
    const { events, targets } = setupEvents();
    expect(events.run(WorldEvent.BLACKOUT)).toBe(true);
    expect(targets.world.setPower).toHaveBeenLastCalledWith(false);
    expect(events.isBlackout).toBe(true);
    events.clock.timer = Infinity; // nothing else happens meanwhile
    events.update(BLACKOUT_TIME + 0.1, { isBusy: false, keysFound: 0 });
    expect(targets.world.setPower).toHaveBeenLastCalledWith(true);
    expect(targets.audio.powerUp).toHaveBeenCalledOnce();
  });

  it('slams a far door shut and the monster comes to see', () => {
    const { events, targets } = setupEvents();
    const [door] = targets.world.doors.doors;
    expect(events.run(WorldEvent.SLAM)).toBe(true);
    expect(door.isOpen).toBe(false);
    expect(targets.audio.doorSlam).toHaveBeenCalledWith(door.position);
    expect(targets.monster.state).toBe(MonsterState.SEARCH);
  });

  it('does not slam a door right next to the player', () => {
    const { events, targets } = setupEvents();
    const [door] = targets.world.doors.doors;
    targets.player.position.set(door.position.x - 3, 0, door.position.z);
    expect(events.run(WorldEvent.SLAM)).toBe(false);
    expect(door.isOpen).toBe(true);
  });

  it('plays a phantom sound behind the player that the monster cannot hear', () => {
    const { events, targets } = setupEvents();
    const hear = vi.spyOn(targets.monster, 'hearNoise');
    events.run(WorldEvent.PHANTOM);
    const [[where]] = targets.audio.phantom.mock.calls;
    expect(where.z).toBeGreaterThan(targets.player.position.z); // yaw 0 looks toward -z: behind is +z
    expect(hear).not.toHaveBeenCalled();
  });

  it('runs what the clock picks', () => {
    const { events, targets } = setupEvents(sequence(0, 0));
    events.update(200, { isBusy: false, keysFound: 0 });
    expect(targets.world.setPower).toHaveBeenCalledWith(false);
  });
});

describe('Flares', () => {
  const lit = () => {
    const scene = new THREE.Scene();
    const flares = new Flares(scene);
    const mesh = new THREE.Mesh();
    scene.add(mesh);
    const item = { type: 'flare', cell: { x: 0, z: 0 }, mesh, phase: 0, isTaken: true };
    flares.ignite(item);
    return { scene, flares, mesh, item };
  };

  it('lights up and pulls the monster over at intervals while it burns', () => {
    const { flares } = lit();
    expect(flares.update(0.1).lure).not.toBeNull();
    expect(flares.light.intensity).toBeGreaterThan(0);
    expect(flares.update(0.1).lure).toBeNull(); // not every frame
  });

  it('burns out after a while: the light goes dark and the stick is gone', () => {
    const { flares, scene, mesh } = lit();
    flares.update(FLARE_BURN_TIME + 1);
    expect(flares.burning).toBeNull();
    expect(flares.light.intensity).toBe(0);
    expect(scene.children).not.toContain(mesh);
  });

  it('dazzles whatever comes close, only once', () => {
    const { flares } = lit();
    expect(flares.dazzles({ x: FLARE_DAZZLE_DISTANCE + 1, z: 0 })).toBe(false);
    expect(flares.dazzles({ x: 1, z: 0 })).toBe(true);
    expect(flares.dazzles({ x: 1, z: 0 })).toBe(false);
  });

  it('keeps one light: a new flare snuffs the old one', () => {
    const { flares, scene, mesh } = lit();
    const lightCount = scene.children.filter((child) => child instanceof THREE.Light).length;
    flares.ignite({ type: 'flare', cell: { x: 0, z: 0 }, mesh: new THREE.Mesh(), phase: 0, isTaken: true });
    expect(scene.children).not.toContain(mesh);
    expect(scene.children.filter((child) => child instanceof THREE.Light)).toHaveLength(lightCount);
  });
});
