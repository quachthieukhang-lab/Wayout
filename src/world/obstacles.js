import * as THREE from 'three';
import { CELL_SIZE, WALL_HEIGHT, cellToWorld, isWallTile } from '../level/level.js';

const DOOR_HEIGHT = 2.4;
const DOOR_THICKNESS = 0.08;
const CHAIN_LINKS = 9;
const LOCK_REACH = 2.1; // m: close enough to read "Locked"
const RUBBLE_CHUNKS = 14;
const BOARDS = 3;

/**
 * What blocks the way this run: doors chained shut (X) and ceilings caved into the halls (Z). Both are solid for the
 * player (a collider fills the cell) and, through the level grid, for the monster and for sight.
 * @param {THREE.Object3D} scene
 * @param {THREE.Box3[]} colliders
 * @param {import('../level/level.js').Level} level
 * @param {() => number} rng
 */
export function createObstacles(scene, colliders, level, rng) {
  const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x4a524f, metalness: 0.45, roughness: 0.65 });
  const chainMaterial = new THREE.MeshStandardMaterial({ color: 0x6b6258, metalness: 0.9, roughness: 0.4 });
  const rubbleMaterial = new THREE.MeshStandardMaterial({ color: 0x5c5650, roughness: 1 });
  const boardMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.9 });

  level.lockedDoors.forEach((cell) => {
    scene.add(buildLockedDoor(level, cell, doorMaterial, chainMaterial));
    colliders.push(cellBox(cell));
  });
  level.barricades.forEach((cell) => {
    scene.add(buildRubble(cell, rubbleMaterial, boardMaterial, rng));
    colliders.push(cellBox(cell));
  });

  const lockedPositions = level.lockedDoors.map(cellToWorld);
  return {
    /** @param {{ x: number, z: number }} position @returns {boolean} standing at a chained door */
    isNearLockedDoor: (position) =>
      lockedPositions.some(({ x, z }) => Math.hypot(position.x - x, position.z - z) < LOCK_REACH),
  };
}

/** @param {import('../level/level.js').Cell} cell */
function cellBox(cell) {
  const { x, z } = cellToWorld(cell);
  const half = CELL_SIZE / 2;
  return new THREE.Box3(new THREE.Vector3(x - half, 0, z - half), new THREE.Vector3(x + half, WALL_HEIGHT, z + half));
}

/** Closed double doors with a chain wound across both handles and a padlock. Both faces get a chain. */
function buildLockedDoor(level, cell, doorMaterial, chainMaterial) {
  const { x, z } = cellToWorld(cell);
  const isAlongX = isWallTile(level, cell.x - 1, cell.z) || isWallTile(level, cell.x + 1, cell.z);
  const frame = new THREE.Group();
  frame.position.set(x, 0, z);
  frame.rotation.y = isAlongX ? 0 : Math.PI / 2;

  const leaves = new THREE.Mesh(new THREE.BoxGeometry(CELL_SIZE, DOOR_HEIGHT, DOOR_THICKNESS), doorMaterial);
  leaves.position.y = DOOR_HEIGHT / 2;
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT - DOOR_HEIGHT, 0.3), doorMaterial);
  lintel.position.y = (WALL_HEIGHT + DOOR_HEIGHT) / 2;
  leaves.castShadow = leaves.receiveShadow = true;
  frame.add(leaves, lintel);

  const link = new THREE.TorusGeometry(0.045, 0.012, 6, 10);
  [-1, 1].forEach((face) => {
    const side = face * (DOOR_THICKNESS / 2 + 0.03);
    for (let i = 0; i < CHAIN_LINKS; i++) {
      const piece = new THREE.Mesh(link, chainMaterial);
      const t = i / (CHAIN_LINKS - 1) - 0.5;
      piece.position.set(t * 0.7, 1.1 - Math.abs(t) * 0.25, side); // sagging a little in the middle
      piece.rotation.set(0, i % 2 === 0 ? 0 : Math.PI / 2, 0);
      frame.add(piece);
    }
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.04), chainMaterial);
    lock.position.set(0, 0.95, side + face * 0.02);
    frame.add(lock);
  });
  return frame;
}

/** A caved-in ceiling: broken slabs heaped to the ceiling, with a few boards jammed through. */
function buildRubble(cell, rubbleMaterial, boardMaterial, rng) {
  const { x, z } = cellToWorld(cell);
  const pile = new THREE.Group();
  pile.position.set(x, 0, z);
  for (let i = 0; i < RUBBLE_CHUNKS; i++) {
    const size = 0.5 + rng() * 0.9;
    const chunk = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.6, size), rubbleMaterial);
    const height = (i / RUBBLE_CHUNKS) * (WALL_HEIGHT - 0.4);
    const spread = (CELL_SIZE / 2) * (1 - (i / RUBBLE_CHUNKS) * 0.6);
    chunk.position.set((rng() - 0.5) * spread * 2, height + size * 0.3, (rng() - 0.5) * spread * 2);
    chunk.rotation.set(rng() * 0.6, rng() * Math.PI, rng() * 0.6);
    chunk.castShadow = chunk.receiveShadow = true;
    pile.add(chunk);
  }
  for (let i = 0; i < BOARDS; i++) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.6, 0.04), boardMaterial);
    board.position.set((rng() - 0.5) * 1.6, 1.3, (rng() - 0.5) * 1.6);
    board.rotation.set((rng() - 0.5) * 0.9, rng() * Math.PI, (rng() - 0.5) * 0.9);
    pile.add(board);
  }
  return pile;
}
