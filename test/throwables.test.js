import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PickupType } from '../src/items/pickups.js';
import { Throwing, MAX_CARRIED } from '../src/items/throwables.js';

const DT = 1 / 60;
const STILL = new THREE.Vector3();

/** A floor slab and a wall 6 m ahead (-Z) of a camera at eye height, looking straight at it. */
function setup() {
  const colliders = [
    new THREE.Box3(new THREE.Vector3(-20, -1, -20), new THREE.Vector3(20, 0, 20)),
    new THREE.Box3(new THREE.Vector3(-20, 0, -9), new THREE.Vector3(20, 3.4, -6)),
  ];
  const scene = new THREE.Scene();
  const throwing = new Throwing(scene, colliders);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.7, 0);
  camera.updateMatrixWorld();
  const item = (type) => ({ type, cell: { x: 0, z: 0 }, mesh: new THREE.Object3D(), phase: 0, isTaken: true });
  return { scene, throwing, camera, item };
}

/** Runs the simulation until nothing is in the air, collecting what happened. */
function simulate(throwing, seconds = 10) {
  const impacts = [];
  const rested = [];
  for (let t = 0; t < seconds && throwing.flying.length > 0; t += DT) {
    const result = throwing.update(DT);
    impacts.push(...result.impacts);
    rested.push(...result.rested);
  }
  return { impacts, rested };
}

describe('Throwing', () => {
  it('carries only a couple of items and throws the last one picked up first', () => {
    const { throwing, camera, item } = setup();
    const bottle = item(PickupType.BOTTLE);
    const can = item(PickupType.CAN);
    throwing.carry(bottle);
    expect(throwing.canCarryMore).toBe(MAX_CARRIED > 1);
    throwing.carry(can);
    expect(throwing.canCarryMore).toBe(false);

    expect(throwing.throwFrom(camera, STILL)).toBe(can);
    expect(throwing.throwFrom(camera, STILL)).toBe(bottle);
    expect(throwing.throwFrom(camera, STILL)).toBeNull(); // empty hands
  });

  it('smashes a bottle on the wall with one loud impact and leaves nothing behind', () => {
    const { scene, throwing, camera, item } = setup();
    const bottle = item(PickupType.BOTTLE);
    throwing.carry(bottle);
    throwing.throwFrom(camera, STILL);
    expect(scene.children).toContain(bottle.mesh);

    const { impacts, rested } = simulate(throwing);
    expect(impacts).toHaveLength(1);
    expect(impacts[0]).toMatchObject({ item: bottle, isFirst: true, breaks: true });
    expect(impacts[0].position.z).toBeGreaterThan(-6.5); // it hit the wall's near face
    expect(rested).toHaveLength(0);
    expect(scene.children).not.toContain(bottle.mesh);
  });

  it('bounces a can off the wall and lets it come to rest on the floor, ready to pick up again', () => {
    const { throwing, camera, item } = setup();
    const can = item(PickupType.CAN);
    throwing.carry(can);
    throwing.throwFrom(camera, STILL);

    const { impacts, rested } = simulate(throwing);
    expect(impacts[0].isFirst).toBe(true);
    expect(impacts.slice(1).every((impact) => !impact.isFirst)).toBe(true);
    expect(rested).toEqual([can]);
    expect(can.mesh.position.y).toBeLessThan(0.2); // lying on the floor
    expect(can.mesh.position.z).toBeGreaterThan(-6); // in front of the wall, not through it
  });

  it('loses a can that flies out where there is no floor (through the open exit) instead of keeping it below the map', () => {
    const scene = new THREE.Scene();
    const throwing = new Throwing(scene, []); // nothing to land on
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 1.7, 0);
    camera.updateMatrixWorld();
    const can = { type: PickupType.CAN, cell: { x: 0, z: 0 }, mesh: new THREE.Object3D(), phase: 0, isTaken: true };
    throwing.carry(can);
    throwing.throwFrom(camera, STILL);

    const { impacts, rested } = simulate(throwing);
    expect(impacts).toHaveLength(0);
    expect(rested).toHaveLength(0);
    expect(throwing.flying).toHaveLength(0);
    expect(scene.children).not.toContain(can.mesh);
  });
});
