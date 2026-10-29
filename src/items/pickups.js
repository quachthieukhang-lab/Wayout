import * as THREE from 'three';
import { cellToWorld, worldToCell } from '../level/level.js';

export const PickupType = Object.freeze({
  KEY: 'key',
  BATTERY: 'battery',
  BOTTLE: 'bottle', // throwables: carried, then thrown to make a noise somewhere else
  CAN: 'can',
});

/** @type {Set<string>} */
const THROWABLE_TYPES = new Set([PickupType.BOTTLE, PickupType.CAN]);
const INTERACT_DISTANCE = 2.2;
const INTERACT_MIN_DOT = 0.85; // how directly the player must look at the item
const HOVER_HEIGHT = 1.0;
const KEY_GLOW = Object.freeze({ base: 0.8, pulse: 0.6, speed: 2.5 }); // keys glint gold so they are easier to spot
const FLOOR_SCATTER = 0.6; // throwables lie up to this far off their cell center (m)
/** Throwables are cylinders as far as physics goes (m). */
export const THROWABLE_SIZE = Object.freeze({
  [PickupType.BOTTLE]: Object.freeze({ radius: 0.038, height: 0.3 }),
  [PickupType.CAN]: Object.freeze({ radius: 0.033, height: 0.12 }),
});

/**
 * @typedef {typeof PickupType[keyof typeof PickupType]} PickupKind
 * @typedef {{ type: PickupKind, cell: import('../level/level.js').Cell, mesh: THREE.Object3D, phase: number, isTaken: boolean }} Pickup
 */

/** @param {Pickup} item */
export function isThrowable(item) {
  return THROWABLE_TYPES.has(item.type);
}

/**
 * Keys and batteries hover and spin where the level puts them; bottles and cans lie still on the floor.
 * @param {THREE.Scene} scene
 * @param {import('../level/level.js').Level} level
 */
export function createPickups(scene, level) {
  const keyMaterial = new THREE.MeshStandardMaterial({
    color: 0xc9a227,
    metalness: 0.8,
    roughness: 0.35,
    emissive: 0xffb020,
  });
  const batteryMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.5, emissive: 0x0b4d16 });
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: 0x3d6b3a,
    roughness: 0.15,
    transparent: true,
    opacity: 0.85,
  });
  const tinMaterial = new THREE.MeshStandardMaterial({ color: 0x8a2a22, metalness: 0.85, roughness: 0.35 });

  /** @type {Pickup[]} */
  const items = [
    ...level.keys.map((cell) => placeItem(PickupType.KEY, cell, createKeyMesh(keyMaterial))),
    ...level.batteries.map((cell) => placeItem(PickupType.BATTERY, cell, createBatteryMesh(batteryMaterial))),
    ...level.throwables.map((cell, i) =>
      i % 2 === 0
        ? placeOnFloor(PickupType.BOTTLE, cell, createBottleMesh(glassMaterial))
        : placeOnFloor(PickupType.CAN, cell, createCanMesh(tinMaterial)),
    ),
  ];
  items.forEach((item) => scene.add(item.mesh));

  const cameraPosition = new THREE.Vector3();
  const cameraDirection = new THREE.Vector3();
  const toItem = new THREE.Vector3();

  /** Puts an item back in the world where its mesh is, so it can be picked up again. @param {Pickup} item */
  const putBack = (item) => {
    item.cell = worldToCell(item.mesh.position.x, item.mesh.position.z);
    item.isTaken = false;
    scene.add(item.mesh);
  };

  return {
    items,

    /** @param {number} time seconds */
    update(time) {
      keyMaterial.emissiveIntensity = KEY_GLOW.base + Math.sin(time * KEY_GLOW.speed) * KEY_GLOW.pulse;
      for (const item of items) {
        if (item.isTaken || isThrowable(item)) continue;
        item.mesh.rotation.y = time * 1.2 + item.phase;
        item.mesh.position.y = HOVER_HEIGHT + Math.sin(time * 2 + item.phase) * 0.05;
      }
    },

    /** Closest item the camera is looking at within reach. @param {THREE.Camera} camera @returns {Pickup | null} */
    findTarget(camera) {
      camera.getWorldPosition(cameraPosition);
      camera.getWorldDirection(cameraDirection);
      let best = null;
      let bestDistance = INTERACT_DISTANCE;
      for (const item of items) {
        if (item.isTaken) continue;
        toItem.subVectors(item.mesh.position, cameraPosition);
        const distance = toItem.length();
        if (distance > bestDistance || toItem.divideScalar(distance).dot(cameraDirection) < INTERACT_MIN_DOT) continue;
        best = item;
        bestDistance = distance;
      }
      return best;
    },

    /** @param {Pickup} item */
    take(item) {
      item.isTaken = true;
      scene.remove(item.mesh);
    },

    /** A thrown item came to rest (its mesh is already there). */
    putBack,

    /**
     * Lays an item from the bag back in the world at (x, z): a bottle or can upright on the floor, a battery hovering.
     * @param {Pickup} item @param {{ x: number, z: number }} point
     */
    drop(item, point) {
      const y = isThrowable(item) ? THROWABLE_SIZE[item.type].height / 2 : HOVER_HEIGHT;
      item.mesh.position.set(point.x, y, point.z);
      item.mesh.rotation.set(0, item.phase, 0);
      putBack(item);
    },

    /** @param {Pickup} item */
    label: (item) => item.type,
  };
}

function placeItem(type, cell, mesh) {
  const { x, z } = cellToWorld(cell);
  mesh.position.set(x, HOVER_HEIGHT, z);
  return { type, cell, mesh, phase: Math.random() * Math.PI * 2, isTaken: false };
}

/** A throwable standing on the floor, a little off the cell center so they do not line up on the grid. */
function placeOnFloor(type, cell, mesh) {
  const item = placeItem(type, cell, mesh);
  mesh.position.x += (Math.random() - 0.5) * 2 * FLOOR_SCATTER;
  mesh.position.z += (Math.random() - 0.5) * 2 * FLOOR_SCATTER;
  mesh.position.y = THROWABLE_SIZE[type].height / 2;
  mesh.rotation.y = item.phase;
  return item;
}

function createKeyMesh(material) {
  const key = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.014, 8, 16), material);
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.022, 0.022), material);
  shaft.position.x = 0.13;
  const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), material);
  tooth.position.set(0.2, -0.03, 0);
  key.add(ring, shaft, tooth);
  key.scale.setScalar(1.4);
  return key;
}

function createBatteryMesh(material) {
  const battery = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.13, 12), material);
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.015, 8),
    new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 1, roughness: 0.3 }),
  );
  cap.position.y = 0.072;
  battery.add(body, cap);
  return battery;
}

/** Bottle centered on its origin (so it tumbles around its middle in flight), upright along Y. */
function createBottleMesh(material) {
  const bottle = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.19, 12), material);
  body.position.y = -0.055;
  const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.038, 0.05, 12), material);
  shoulder.position.y = 0.065;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.014, 0.06, 8), material);
  neck.position.y = 0.12;
  bottle.add(body, shoulder, neck);
  return bottle;
}

/** Soda can centered on its origin, upright along Y. */
function createCanMesh(material) {
  const { radius, height } = THROWABLE_SIZE[PickupType.CAN];
  return new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 14), material);
}
