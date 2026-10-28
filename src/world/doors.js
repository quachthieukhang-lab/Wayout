import * as THREE from 'three';
import { CELL_SIZE, WALL_HEIGHT, cellToWorld, isWallTile } from '../level/level.js';

const HEIGHT = 2.4;
const THICKNESS = 0.08;
const OPEN_ANGLE = Math.PI * 0.47; // leaves swing almost flat against the doorway sides
const SWING_SPEED = 5; // rad/s
const REACH = 2.1; // how close the player must stand to use a door (m)
const MONSTER_REACH = 2.2; // it stops this far from a closed door on its path and forces it
const CLEARANCE = 0.9; // a door will not close on anyone standing this close to it

/**
 * @typedef {{
 *   cell: import('../level/level.js').Cell, position: THREE.Vector3, isOpen: boolean, swingSpeed: number,
 *   pivots: THREE.Object3D[], collider: THREE.Box3,
 * }} Door
 */

/**
 * Swinging double doors in doorways (D). They start open. A closed door blocks sight (it flips the cell in
 * `level.opaque`) and the player (its collider joins `colliders`); the monster forces it open, slowly and loudly.
 * @param {THREE.Object3D} scene
 * @param {THREE.Box3[]} colliders
 * @param {import('../level/level.js').Level} level
 */
export function createDoors(scene, colliders, level) {
  const material = new THREE.MeshStandardMaterial({ color: 0x55625e, metalness: 0.45, roughness: 0.6 });
  const doors = level.doors.map((cell) => buildDoor(scene, level, cell, material));

  /** @param {Door} door @param {{ x: number, z: number }} position */
  const distanceTo = (door, position) => Math.hypot(position.x - door.position.x, position.z - door.position.z);

  return {
    doors,

    /** Swings the leaves toward open or shut. @param {number} dt */
    update(dt) {
      for (const door of doors) {
        const target = door.isOpen ? OPEN_ANGLE : 0;
        door.pivots.forEach((pivot, side) => {
          const angle = Math.abs(pivot.rotation.y);
          const next = angle + Math.sign(target - angle) * Math.min(door.swingSpeed * dt, Math.abs(target - angle));
          pivot.rotation.y = side === 0 ? next : -next;
        });
      }
    },

    /** Closest door within reach. @param {{ x: number, z: number }} position @returns {Door | null} */
    findNear(position) {
      let best = null;
      let bestDistance = REACH;
      for (const door of doors) {
        const distance = distanceTo(door, position);
        if (distance < bestDistance) [best, bestDistance] = [door, distance];
      }
      return best;
    },

    /** Someone stands in the way of closing it. @param {Door} door @param {{ x: number, z: number }} position */
    isBlocked: (door, position) => distanceTo(door, position) < CLEARANCE,

    /** @param {Door} door @param {boolean} isOpen @param {number} [swingSpeed] how fast it swings (rad/s) */
    setOpen(door, isOpen, swingSpeed = SWING_SPEED) {
      if (door.isOpen === isOpen) return;
      door.isOpen = isOpen;
      door.swingSpeed = swingSpeed;
      level.opaque[door.cell.z][door.cell.x] = !isOpen;
      const index = colliders.indexOf(door.collider);
      if (isOpen && index >= 0) colliders.splice(index, 1);
      if (!isOpen && index < 0) colliders.push(door.collider);
    },

    /**
     * The closed door it is about to walk into, if any.
     * @param {{ x: number, z: number }} position the monster
     * @param {import('../level/level.js').Cell | null} nextCell the next cell on its path
     * @returns {Door | null}
     */
    closedDoorAhead(position, nextCell) {
      if (!nextCell) return null;
      return (
        doors.find(
          (door) =>
            !door.isOpen &&
            door.cell.x === nextCell.x &&
            door.cell.z === nextCell.z &&
            distanceTo(door, position) < MONSTER_REACH,
        ) ?? null
      );
    },
  };
}

/** Two leaves hinged on the doorway's sides, plus a lintel above them. Built open. */
function buildDoor(scene, level, cell, material) {
  const { x, z } = cellToWorld(cell);
  const isAlongX = isWallTile(level, cell.x - 1, cell.z) || isWallTile(level, cell.x + 1, cell.z); // the wall runs along X
  const frame = new THREE.Group();
  frame.position.set(x, 0, z);
  frame.rotation.y = isAlongX ? 0 : Math.PI / 2;

  const leafGeometry = new THREE.BoxGeometry(CELL_SIZE / 2 - 0.02, HEIGHT, THICKNESS);
  const pivots = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.x = (side * CELL_SIZE) / 2;
    const leaf = new THREE.Mesh(leafGeometry, material);
    leaf.position.set((-side * CELL_SIZE) / 4, HEIGHT / 2, 0);
    leaf.castShadow = leaf.receiveShadow = true;
    pivot.add(leaf);
    pivot.rotation.y = side < 0 ? OPEN_ANGLE : -OPEN_ANGLE;
    frame.add(pivot);
    return pivot;
  });
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT - HEIGHT, 0.3), material);
  lintel.position.y = (WALL_HEIGHT + HEIGHT) / 2;
  frame.add(lintel);
  scene.add(frame);

  const halfX = isAlongX ? CELL_SIZE / 2 : THICKNESS;
  const halfZ = isAlongX ? THICKNESS : CELL_SIZE / 2;
  const collider = new THREE.Box3(
    new THREE.Vector3(x - halfX, 0, z - halfZ),
    new THREE.Vector3(x + halfX, WALL_HEIGHT, z + halfZ),
  );
  return { cell, position: new THREE.Vector3(x, 0, z), isOpen: true, swingSpeed: SWING_SPEED, pivots, collider };
}
