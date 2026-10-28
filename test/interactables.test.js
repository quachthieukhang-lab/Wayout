import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { LEVEL_MAP, parseLevel, cellToWorld, isWalkable, isTransparent, noisyFloorAt } from '../src/level/level.js';
import { findPath, hasLineOfSight } from '../src/level/pathfinding.js';
import { createDoors } from '../src/world/doors.js';
import { createRadios, PLAY_TIME } from '../src/world/radios.js';
import { Monster } from '../src/monster/monster.js';

// A door between two rooms, glass and boards by the spawn, a radio in the far room.
const MAP = ['#######', '#P.#..#', 'E..D.M#', '#GW#R.#', '#######'];
const DT = 1 / 60;

function setup() {
  const level = parseLevel(MAP);
  const scene = new THREE.Scene();
  const colliders = [];
  return { level, scene, colliders, doors: createDoors(scene, colliders, level) };
}

const at = (x, z) => {
  const world = cellToWorld({ x, z });
  return new THREE.Vector3(world.x, 0, world.z);
};

describe('doors', () => {
  it('start open: walkable, see-through, no collider', () => {
    const { level, colliders, doors } = setup();
    const [door] = doors.doors;
    expect(door.isOpen).toBe(true);
    expect(isWalkable(level, 3, 2)).toBe(true);
    expect(isTransparent(level, 3, 2)).toBe(true);
    expect(colliders).not.toContain(door.collider);
  });

  it('block sight and the player once closed, and let both through again once opened', () => {
    const { level, colliders, doors } = setup();
    const [door] = doors.doors;

    doors.setOpen(door, false);
    expect(hasLineOfSight(level, at(1, 2), at(5, 2))).toBe(false);
    expect(colliders).toContain(door.collider);
    expect(findPath(level, { x: 1, z: 2 }, { x: 5, z: 2 })).not.toBeNull(); // still a route: it can be opened

    doors.setOpen(door, true);
    expect(hasLineOfSight(level, at(1, 2), at(5, 2))).toBe(true);
    expect(colliders).not.toContain(door.collider);
  });

  it('report a closed door on the monster path only when it is close', () => {
    const { doors } = setup();
    const [door] = doors.doors;
    const near = new THREE.Vector3(door.position.x + 1.5, 0, door.position.z); // halfway from the next cell
    expect(doors.closedDoorAhead(near, door.cell)).toBeNull(); // still open

    doors.setOpen(door, false);
    expect(doors.closedDoorAhead(near, door.cell)).toBe(door);
    expect(doors.closedDoorAhead(at(5, 2), door.cell)).toBeNull(); // too far
    expect(doors.closedDoorAhead(near, { x: 4, z: 1 })).toBeNull(); // not heading through it
  });

  it('will not close on someone standing in the doorway', () => {
    const { doors } = setup();
    const [door] = doors.doors;
    expect(doors.isBlocked(door, door.position)).toBe(true);
    expect(doors.isBlocked(door, at(5, 2))).toBe(false);
  });
});

describe('radios', () => {
  it('play for a while, pulsing noise, then rest before they can play again', () => {
    const { level, scene, colliders } = setup();
    const radios = createRadios(scene, colliders, level);
    const [radio] = radios.radios;
    expect(colliders).toHaveLength(1); // the crate

    expect(radios.switchOn(radio)).toBe(true);
    expect(radios.switchOn(radio)).toBe(false); // already playing
    let pulses = 0;
    for (let t = 0; t < PLAY_TIME + 1; t += DT) pulses += radios.update(DT).length;
    expect(pulses).toBe(3); // at 0 s, 2 s and 4 s
    expect(radio.timeLeft).toBe(0);
    expect(radios.switchOn(radio)).toBe(false); // resting

    for (let t = 0; t < 31; t += DT) radios.update(DT);
    expect(radios.switchOn(radio)).toBe(true);
  });

  it('can be reached from close by only', () => {
    const { level, scene, colliders } = setup();
    const radios = createRadios(scene, colliders, level);
    const [radio] = radios.radios;
    expect(radios.findNear(radio.position)).toBe(radio);
    expect(radios.findNear(at(1, 1))).toBeNull();
  });
});

describe('noisy floors', () => {
  it('make glass louder than loose boards, and plain floor silent', () => {
    const level = parseLevel(MAP);
    expect(noisyFloorAt(level, 1, 3)?.sound).toBe('glass');
    expect(noisyFloorAt(level, 2, 3)?.sound).toBe('boards');
    expect(noisyFloorAt(level, 1, 3).radius).toBeGreaterThan(noisyFloorAt(level, 2, 3).radius);
    expect(noisyFloorAt(level, 1, 1)).toBeNull();
    expect(noisyFloorAt(level, -1, 0)).toBeNull();
  });
});

describe('main map', () => {
  const level = parseLevel(LEVEL_MAP);

  it('puts every door in a doorway, between two walls', () => {
    expect(level.doors.length).toBeGreaterThanOrEqual(6);
    level.doors.forEach(({ x, z }) => {
      const wall = (dx, dz) => !isWalkable(level, x + dx, z + dz);
      expect((wall(-1, 0) && wall(1, 0)) || (wall(0, -1) && wall(0, 1))).toBe(true);
    });
  });

  it('has radios and noisy floors the player can reach', () => {
    expect(level.radios.length).toBeGreaterThanOrEqual(2);
    expect(level.noisyFloors.length).toBeGreaterThanOrEqual(6);
    [...level.radios, ...level.noisyFloors].forEach((cell) => {
      expect(findPath(level, level.spawn, cell)).not.toBeNull();
    });
  });
});

describe('Monster at a door', () => {
  it('holds still while it forces a door, then carries on', () => {
    const level = parseLevel(MAP);
    const monster = new Monster(level, () => 0.5);
    const hidden = { position: at(1, 1), noiseRadius: 0, isCrouching: true, isLit: false };
    monster.alert(at(1, 2));
    monster.update(DT, hidden); // plans its path
    monster.hold(1);
    const start = monster.position.clone();
    for (let i = 0; i < 50; i++) monster.update(DT, hidden);
    expect(monster.position.distanceTo(start)).toBeLessThan(0.001);
    for (let i = 0; i < 60; i++) monster.update(DT, hidden);
    expect(monster.position.distanceTo(start)).toBeGreaterThan(0.5);
  });
});
