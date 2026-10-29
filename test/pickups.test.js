import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { parseLevel, cellToWorld } from '../src/level/level.js';
import { createPickups, PickupType, THROWABLE_SIZE, isThrowable } from '../src/items/pickups.js';

// A key and a battery in the top row, a bottle and a can below them.
const MAP = ['######', 'EPKB.#', '#O.OM#', '######'];

function setup() {
  const scene = new THREE.Scene();
  return { scene, pickups: createPickups(scene, parseLevel(MAP)) };
}

/** A camera standing on a cell's south edge, looking north at whatever hovers in the cell. */
function cameraLookingAt(cell, height = 1) {
  const { x, z } = cellToWorld(cell);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(x, height, z + 1.2);
  camera.lookAt(x, height, z);
  camera.updateMatrixWorld();
  return camera;
}

describe('pickups', () => {
  it('places every key, battery and throwable of the level in the scene', () => {
    const { scene, pickups } = setup();
    const types = pickups.items.map((item) => item.type).sort();
    expect(types).toEqual([PickupType.BATTERY, PickupType.BOTTLE, PickupType.CAN, PickupType.KEY].sort());
    pickups.items.forEach((item) => expect(scene.children).toContain(item.mesh));
  });

  it('lays bottles and cans on the floor near their cell, and only they are throwable', () => {
    const { pickups } = setup();
    for (const item of pickups.items) {
      expect(isThrowable(item)).toBe(item.type === PickupType.BOTTLE || item.type === PickupType.CAN);
      if (!isThrowable(item)) continue;
      const { x, z } = cellToWorld(item.cell);
      expect(item.mesh.position.y).toBeCloseTo(THROWABLE_SIZE[item.type].height / 2);
      expect(Math.abs(item.mesh.position.x - x)).toBeLessThanOrEqual(0.6);
      expect(Math.abs(item.mesh.position.z - z)).toBeLessThanOrEqual(0.6);
    }
  });

  it('targets the item the camera looks at, within reach', () => {
    const { pickups } = setup();
    const key = pickups.items.find((item) => item.type === PickupType.KEY);
    expect(pickups.findTarget(cameraLookingAt(key.cell))).toBe(key);

    const away = cameraLookingAt(key.cell);
    away.lookAt(away.position.x, away.position.y, away.position.z + 1); // turned around
    away.updateMatrixWorld();
    expect(pickups.findTarget(away)).toBeNull();
  });

  it('takes an item out of the world, and puts a thrown one back where it landed', () => {
    const { scene, pickups } = setup();
    const can = pickups.items.find((item) => item.type === PickupType.CAN);
    pickups.take(can);
    expect(can.isTaken).toBe(true);
    expect(scene.children).not.toContain(can.mesh);

    const landing = cellToWorld({ x: 4, z: 1 });
    can.mesh.position.set(landing.x, 0.06, landing.z);
    pickups.putBack(can);
    expect(can.isTaken).toBe(false);
    expect(can.cell).toEqual({ x: 4, z: 1 });
    expect(scene.children).toContain(can.mesh);
  });

  it('makes keys and batteries hover, but leaves floor items still', () => {
    const { pickups } = setup();
    const bottle = pickups.items.find((item) => item.type === PickupType.BOTTLE);
    const key = pickups.items.find((item) => item.type === PickupType.KEY);
    const bottleY = bottle.mesh.position.y;
    pickups.update(0.4);
    expect(key.mesh.position.y).toBeGreaterThan(0.9);
    expect(bottle.mesh.position.y).toBe(bottleY);
  });
});
