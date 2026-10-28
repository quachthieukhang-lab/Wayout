import * as THREE from 'three';
import { CELL_SIZE, cellToWorld, isVent, isWalkable, isWallTile, roomAt } from '../level/level.js';
import { createPaintTexture, createRoomSignTexture } from './textures.js';

const PAINT_HEIGHT = 1.29; // covers the dark lower panel of the wall texture
const PAINT_OFFSET = 0.005; // off the wall face, behind the scrawled messages
const SIGN_SIZE = Object.freeze({ width: 1.4, height: 0.35 });
const SIGN_HEIGHT = 2.2;
const SIGN_OFFSET = 0.02;
const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Gives every room its own look: its walls get a band of its colour, and each doorway out of it gets a name plate
 * on the hall side, so the player can tell the rooms apart and find their way back.
 * @param {THREE.Scene} scene
 * @param {import('../level/level.js').Level} level
 * @param {readonly import('../level/level.js').Room[]} rooms
 * @param {() => number} rng
 */
export function addRoomPaint(scene, level, rooms, rng) {
  const roomCells = level.floorCells
    .filter((cell) => !isVent(level, cell.x, cell.z))
    .map((cell) => ({ cell, room: roomAt(rooms, cell) }))
    .filter(({ room }) => room !== null);
  addPaintBands(scene, level, roomCells, rng);
  addDoorSigns(scene, level, rooms, roomCells);
}

/** One instanced plane per wall face that borders a room, tinted with the room's colour. */
function addPaintBands(scene, level, roomCells, rng) {
  const faces = roomCells.flatMap(({ cell, room }) =>
    DIRECTIONS.filter(([dx, dz]) => isWallTile(level, cell.x + dx, cell.z + dz)).map(([dx, dz]) => ({
      cell,
      room,
      dx,
      dz,
    })),
  );
  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(CELL_SIZE, PAINT_HEIGHT),
    new THREE.MeshStandardMaterial({
      map: createPaintTexture(rng),
      roughness: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
    faces.length,
  );
  const placement = new THREE.Object3D();
  const color = new THREE.Color();
  faces.forEach(({ cell, room, dx, dz }, i) => {
    const { x, z } = cellToWorld(cell);
    const toFace = CELL_SIZE / 2 - PAINT_OFFSET;
    placement.position.set(x + dx * toFace, PAINT_HEIGHT / 2, z + dz * toFace);
    placement.rotation.set(0, Math.atan2(-dx, -dz), 0); // face back into the room
    placement.updateMatrix();
    mesh.setMatrixAt(i, placement.matrix);
    mesh.setColorAt(i, color.setHex(room.color));
  });
  mesh.receiveShadow = true;
  scene.add(mesh);
}

/** A name plate beside each doorway out of a room, on the wall facing the hall. */
function addDoorSigns(scene, level, rooms, roomCells) {
  const geometry = new THREE.PlaneGeometry(SIGN_SIZE.width, SIGN_SIZE.height);
  /** @type {Map<string, THREE.Material>} */
  const materials = new Map();
  const materialFor = (room) => {
    if (!materials.has(room.name)) {
      materials.set(room.name, new THREE.MeshStandardMaterial({ map: createRoomSignTexture(room.name, room.color) }));
    }
    return materials.get(room.name);
  };

  for (const { cell, room } of roomCells) {
    if (room.isHall) continue;
    for (const [dx, dz] of DIRECTIONS) {
      const door = { x: cell.x + dx, z: cell.z + dz };
      if (!isDoorway(level, rooms, door, room)) continue;
      const wall = besideDoor(level, door, dx, dz);
      if (!wall) continue;
      const { x, z } = cellToWorld(wall);
      const toFace = CELL_SIZE / 2 + SIGN_OFFSET;
      const sign = new THREE.Mesh(geometry, materialFor(room));
      sign.position.set(x + dx * toFace, SIGN_HEIGHT, z + dz * toFace);
      sign.rotation.y = Math.atan2(dx, dz); // faces away from the room, toward the hall
      scene.add(sign);
    }
  }
}

/** An open cell next to the room that is not part of it (and not a vent: the signs mark real doors). */
function isDoorway(level, rooms, cell, room) {
  return isWalkable(level, cell.x, cell.z) && !isVent(level, cell.x, cell.z) && roomAt(rooms, cell) !== room;
}

/** The wall cell on either side of a doorway whose hall-side face is visible, or null. */
function besideDoor(level, door, dx, dz) {
  const sides = [
    { x: door.x + dz, z: door.z + dx },
    { x: door.x - dz, z: door.z - dx },
  ];
  return sides.find((s) => isWallTile(level, s.x, s.z) && isWalkable(level, s.x + dx, s.z + dz)) ?? null;
}
