import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cellToWorld } from '../level/level.js';

const BED = Object.freeze({ width: 1.0, length: 2.2, height: 0.62 });
const SHELF = Object.freeze({ width: 2.6, depth: 1.1, height: 2.4, levels: 5 });
const MAX_BOXES_PER_SHELF = 3;
const JITTER = 0.12; // radians: nothing in here stands quite straight anymore

/**
 * Beds (T) and shelving (S). Every piece gets one Box3 collider; all pieces share one merged mesh
 * per material so the furniture costs three draw calls in total.
 * @param {THREE.Scene} scene
 * @param {THREE.Box3[]} colliders
 * @param {import('../level/level.js').Level} level
 * @param {() => number} rng
 */
export function addFurniture(scene, colliders, level, rng) {
  const parts = emptyParts();
  level.beds.forEach((cell) => place(parts, colliders, cell, rng, buildBed));
  level.shelves.forEach((cell) => place(parts, colliders, cell, rng, buildShelf));

  const materials = {
    metal: new THREE.MeshStandardMaterial({ color: 0x6b6f6c, metalness: 0.55, roughness: 0.55 }),
    fabric: new THREE.MeshStandardMaterial({ color: 0x8f8b7d, roughness: 0.95 }),
    cardboard: new THREE.MeshStandardMaterial({ color: 0x6e5236, roughness: 0.9 }),
  };
  for (const [name, geometries] of Object.entries(parts)) {
    if (geometries.length === 0) continue;
    const mesh = new THREE.Mesh(mergeGeometries(geometries), materials[name]);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    geometries.forEach((geometry) => geometry.dispose());
  }
}

const emptyParts = () => ({ metal: [], fabric: [], cardboard: [] });

/** Builds one piece around the origin, turns it to a random right angle (plus a little jitter) and moves it into its cell. */
function place(parts, colliders, cell, rng, build) {
  const piece = emptyParts();
  build(piece, rng);

  const { x, z } = cellToWorld(cell);
  const yaw = (rng() < 0.5 ? 0 : Math.PI / 2) + (rng() - 0.5) * JITTER;
  const matrix = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z);
  const bounds = new THREE.Box3();
  for (const [name, geometries] of Object.entries(piece)) {
    for (const geometry of geometries) {
      geometry.applyMatrix4(matrix);
      geometry.computeBoundingBox();
      bounds.union(geometry.boundingBox);
      parts[name].push(geometry);
    }
  }
  colliders.push(bounds);
}

function box(list, width, height, depth, x, y, z) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.translate(x, y, z);
  list.push(geometry);
}

/** Rusty hospital bed: frame on four legs, headboard, a stained mattress and a pillow. */
function buildBed({ metal, fabric }) {
  const { width, length, height } = BED;
  const frameY = height - 0.1;
  box(metal, width, 0.06, length, 0, frameY, 0);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1])
      box(metal, 0.05, frameY, 0.05, sx * (width / 2 - 0.04), frameY / 2, sz * (length / 2 - 0.04));
  }
  box(metal, width, 0.55, 0.05, 0, height + 0.15, -length / 2);
  box(fabric, width - 0.06, 0.16, length - 0.1, 0, height + 0.01, 0);
  box(fabric, 0.55, 0.1, 0.32, 0, height + 0.14, -length / 2 + 0.28);
}

/** Double-sided metal shelving with a solid spine (you cannot see through it) and boxes on both sides. */
function buildShelf({ metal, cardboard }, rng) {
  const { width, depth, height, levels } = SHELF;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1])
      box(metal, 0.05, height, 0.05, sx * (width / 2 - 0.03), height / 2, sz * (depth / 2 - 0.03));
  }
  box(metal, width - 0.06, height - 0.1, 0.02, 0, height / 2, 0);

  const gap = (height - 0.15) / (levels - 1);
  for (let i = 0; i < levels; i++) {
    const y = 0.1 + i * gap;
    box(metal, width, 0.03, depth, 0, y, 0);
    if (i === levels - 1) continue;
    for (const side of [-1, 1]) addBoxes(cardboard, rng, y, (side * depth) / 4, gap);
  }
}

function addBoxes(list, rng, shelfY, z, gap) {
  const count = Math.floor(rng() * (MAX_BOXES_PER_SHELF + 1));
  for (let i = 0; i < count; i++) {
    const w = 0.3 + rng() * 0.3;
    const h = Math.min(0.18 + rng() * 0.2, gap - 0.08);
    const d = 0.3 + rng() * 0.12;
    const x = (rng() - 0.5) * (SHELF.width - w - 0.1);
    box(list, w, h, d, x, shelfY + 0.015 + h / 2, z);
  }
}
