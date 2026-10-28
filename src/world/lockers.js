import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL_SIZE, cellToWorld, lockerWall } from '../level/level.js';
import { createLockerDoorTexture } from './textures.js';

const WIDTH = 0.9;
const HEIGHT = 2.1;
const DEPTH = 0.7;
const PANEL = 0.04;
const WALL_GAP = 0.02;
const REACH = 1.6; // how close to the door the player must stand to climb in
const STEP_OUT = 1.1; // where the player stands after climbing out, measured from the locker's center

/**
 * @typedef {{ cell: import('../level/level.js').Cell, inside: THREE.Vector3, front: THREE.Vector3, door: THREE.Vector3, yaw: number }} HidingSpot
 *   `yaw` is the player yaw that looks out through the door.
 */

/**
 * Tall metal lockers (H) standing against a wall. The door has slits to peek through.
 * All lockers are merged into two meshes (body + doors) to keep draw calls and shadow passes cheap.
 * @param {THREE.Scene} scene
 * @param {THREE.Box3[]} colliders
 * @param {import('../level/level.js').Level} level
 * @param {() => number} rng
 */
export function createLockers(scene, colliders, level, rng) {
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x4f5e58,
    metalness: 0.5,
    roughness: 0.6,
    side: THREE.DoubleSide,
  });
  const doorMaterial = new THREE.MeshStandardMaterial({
    map: createLockerDoorTexture(rng),
    metalness: 0.5,
    roughness: 0.6,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
  const geometries = {
    side: new THREE.BoxGeometry(PANEL, HEIGHT, DEPTH),
    back: new THREE.BoxGeometry(WIDTH, HEIGHT, PANEL),
    cap: new THREE.BoxGeometry(WIDTH, PANEL, DEPTH),
    door: new THREE.PlaneGeometry(WIDTH - PANEL, HEIGHT - PANEL),
  };
  const parts = { body: [], door: [] };
  const matrix = new THREE.Matrix4();

  /** @type {HidingSpot[]} */
  const spots = level.lockers.map((cell) => {
    const [dx, dz] = lockerWall(level, cell);
    const { x, z } = cellToWorld(cell);
    const offset = CELL_SIZE / 2 - DEPTH / 2 - WALL_GAP;
    const inside = new THREE.Vector3(x + dx * offset, 0, z + dz * offset);

    // local +Z (the door) faces away from the wall
    matrix.makeRotationY(Math.atan2(-dx, -dz)).setPosition(inside);
    const part = (list, geometry, px, py, pz) => list.push(geometry.clone().translate(px, py, pz).applyMatrix4(matrix));
    part(parts.body, geometries.side, -WIDTH / 2, HEIGHT / 2, 0);
    part(parts.body, geometries.side, WIDTH / 2, HEIGHT / 2, 0);
    part(parts.body, geometries.back, 0, HEIGHT / 2, -DEPTH / 2);
    part(parts.body, geometries.cap, 0, HEIGHT, 0);
    part(parts.body, geometries.cap, 0, PANEL / 2, 0);
    part(parts.door, geometries.door, 0, HEIGHT / 2, DEPTH / 2);

    const halfX = dx !== 0 ? DEPTH / 2 : WIDTH / 2;
    const halfZ = dx !== 0 ? WIDTH / 2 : DEPTH / 2;
    colliders.push(
      new THREE.Box3(
        new THREE.Vector3(inside.x - halfX, 0, inside.z - halfZ),
        new THREE.Vector3(inside.x + halfX, HEIGHT, inside.z + halfZ),
      ),
    );

    return {
      cell,
      inside,
      front: new THREE.Vector3(inside.x - dx * STEP_OUT, 0, inside.z - dz * STEP_OUT),
      door: new THREE.Vector3(inside.x - dx * (DEPTH / 2), 0, inside.z - dz * (DEPTH / 2)),
      yaw: Math.atan2(dx, dz), // player forward (-sin, -cos) = away from the wall
    };
  });

  if (spots.length > 0) {
    /** @type {[THREE.BufferGeometry[], THREE.Material][]} */
    const groups = [
      [parts.body, bodyMaterial],
      [parts.door, doorMaterial],
    ];
    for (const [list, material] of groups) {
      const mesh = new THREE.Mesh(mergeGeometries(list), material);
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }
  [...parts.body, ...parts.door, ...Object.values(geometries)].forEach((geometry) => geometry.dispose());

  return {
    spots,

    /** Closest locker door within reach. @param {THREE.Vector3} position @returns {HidingSpot | null} */
    findNear(position) {
      let best = null;
      let bestDistance = REACH;
      for (const spot of spots) {
        const distance = Math.hypot(spot.door.x - position.x, spot.door.z - position.z);
        if (distance < bestDistance) [best, bestDistance] = [spot, distance];
      }
      return best;
    },
  };
}
