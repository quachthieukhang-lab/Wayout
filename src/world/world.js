import * as THREE from 'three';
import { CELL_SIZE, WALL_HEIGHT, cellToWorld, isWalkable, isWallTile, roomAt } from '../level/level.js';
import { addFurniture } from './furniture.js';
import { createLockers } from './lockers.js';
import { addRoomPaint } from './rooms.js';
import {
  createRng,
  createWallTexture,
  createFloorTexture,
  createCeilingTexture,
  createBloodTexture,
  createMessageTexture,
  createExitSignTexture,
} from './textures.js';

const FOG_COLOR = 0x030304;
const FOG_DENSITY = 0.085;
const AMBIENT_INTENSITY = 0.35;

const LAMP_COLOR = 0xffc98a;
const LAMP_ROOM_TINT = 0.25; // how much a lamp takes on its room's colour
const LAMP_INTENSITY = 7;
const LAMP_RANGE = 10;
const LAMP_DIM = 0.03;
const LAMP_GLOW = 12; // emissive strength of the lamp panel, high enough to pass the bloom threshold
const BROKEN_LAMP_CHANCE = 0.5;

const EXIT_LIGHT_INTENSITY = 30;
const DOOR_OPEN_SPEED = 0.8; // m/s

const VENT_CLEARANCE = 1.2; // crouched player is 1.0 m tall, standing 1.8 m

const BLOOD_DECALS = 14;
const WALL_MESSAGES = ['RUN', 'IT CAN HEAR YOU', 'LIGHTS OFF', 'IT IS HERE', '5 KEYS'];
const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Builds the abandoned hospital from a parsed level. Every solid cell gets a Box3 in `colliders`.
 * @param {import('../level/level.js').Level} level
 * @param {readonly import('../level/level.js').Room[]} [rooms] painted in their own colours
 */
export function createWorld(level, rooms = [], seed = 7) {
  const rng = createRng(seed);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG_COLOR);
  scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
  scene.add(new THREE.HemisphereLight(0x2a3040, 0x080606, AMBIENT_INTENSITY));

  const colliders = [];
  addFloorAndCeiling(scene, colliders, level, rng);
  addWalls(scene, colliders, level, rng);
  addVents(scene, colliders, level);
  addFurniture(scene, colliders, level, rng);
  const lockers = createLockers(scene, colliders, level, rng);
  addBloodDecals(scene, level, rng);
  addWallMessages(scene, level, rng);
  addRoomPaint(scene, level, rooms, rng);
  const lamps = level.lamps.map((cell) =>
    createLamp(scene, cell, rng() < BROKEN_LAMP_CHANCE, lampColor(roomAt(rooms, cell))),
  );
  const exit = createExitDoor(scene, colliders, level);

  return {
    scene,
    colliders,
    lockers,
    /** @param {number} dt */
    update(dt) {
      lamps.forEach((lamp) => lamp.update(dt));
      exit.update(dt);
    },
    openExit: () => exit.open(),
  };
}

function addFloorAndCeiling(scene, colliders, level, rng) {
  const width = level.width * CELL_SIZE;
  const depth = level.height * CELL_SIZE;
  const centerX = ((level.width - 1) * CELL_SIZE) / 2;
  const centerZ = ((level.height - 1) * CELL_SIZE) / 2;

  const surface = (texture, roughness, y, rotationX) => {
    texture.repeat.set(level.width, level.height);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshStandardMaterial({ map: texture, roughness }),
    );
    mesh.rotation.x = rotationX;
    mesh.position.set(centerX, y, centerZ);
    mesh.receiveShadow = true;
    scene.add(mesh);
  };
  surface(createFloorTexture(rng), 0.7, 0, -Math.PI / 2);
  surface(createCeilingTexture(rng), 1, WALL_HEIGHT, Math.PI / 2);

  const slab = (minY, maxY) =>
    new THREE.Box3(
      new THREE.Vector3(centerX - width / 2, minY, centerZ - depth / 2),
      new THREE.Vector3(centerX + width / 2, maxY, centerZ + depth / 2),
    );
  colliders.push(slab(-1, 0), slab(WALL_HEIGHT, WALL_HEIGHT + 1));
}

function addWalls(scene, colliders, level, rng) {
  const cells = [];
  level.walls.forEach((row, z) =>
    row.forEach((_, x) => {
      if (isWallTile(level, x, z)) cells.push({ x, z });
    }),
  );

  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT, CELL_SIZE),
    new THREE.MeshStandardMaterial({ map: createWallTexture(rng), roughness: 0.95 }),
    cells.length,
  );
  const matrix = new THREE.Matrix4();
  cells.forEach((cell, i) => {
    const { x, z } = cellToWorld(cell);
    mesh.setMatrixAt(i, matrix.makeTranslation(x, WALL_HEIGHT / 2, z));
    colliders.push(cellCollider(cell));
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

/** Crawl ducts: a metal block fills each vent cell above VENT_CLEARANCE, so only a crouching player fits. */
function addVents(scene, colliders, level) {
  const height = WALL_HEIGHT - VENT_CLEARANCE;
  const geometry = new THREE.BoxGeometry(CELL_SIZE, height, CELL_SIZE);
  const material = new THREE.MeshStandardMaterial({ color: 0x3a3d40, metalness: 0.6, roughness: 0.45 });
  const half = CELL_SIZE / 2;
  level.vents.forEach((cell) => {
    const { x, z } = cellToWorld(cell);
    const duct = new THREE.Mesh(geometry, material);
    duct.position.set(x, VENT_CLEARANCE + height / 2, z);
    duct.castShadow = duct.receiveShadow = true;
    scene.add(duct);
    colliders.push(
      new THREE.Box3(
        new THREE.Vector3(x - half, VENT_CLEARANCE, z - half),
        new THREE.Vector3(x + half, WALL_HEIGHT, z + half),
      ),
    );
  });
}

function cellCollider(cell) {
  const { x, z } = cellToWorld(cell);
  const half = CELL_SIZE / 2;
  return new THREE.Box3(new THREE.Vector3(x - half, 0, z - half), new THREE.Vector3(x + half, WALL_HEIGHT, z + half));
}

/** Material for flat decals that sit on top of another surface without z-fighting. */
function decalMaterial(map) {
  return new THREE.MeshStandardMaterial({
    map,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    roughness: 0.4,
  });
}

function addBloodDecals(scene, level, rng) {
  const material = decalMaterial(createBloodTexture(rng));
  const geometry = new THREE.PlaneGeometry(1, 1);
  for (let i = 0; i < BLOOD_DECALS; i++) {
    const { x, z } = cellToWorld(level.floorCells[Math.floor(rng() * level.floorCells.length)]);
    const decal = new THREE.Mesh(geometry, material);
    decal.rotation.set(-Math.PI / 2, 0, rng() * Math.PI * 2);
    decal.scale.setScalar(1.2 + rng() * 1.2);
    decal.position.set(x + (rng() - 0.5) * 1.5, 0.01, z + (rng() - 0.5) * 1.5);
    decal.receiveShadow = true;
    scene.add(decal);
  }
}

/** Writes messages on random wall faces that border a floor cell. */
function addWallMessages(scene, level, rng) {
  const faces = level.floorCells
    .filter((cell) => level.tiles[cell.z][cell.x] !== 'H')
    .flatMap((cell) =>
      DIRECTIONS.filter(([dx, dz]) => isWallTile(level, cell.x + dx, cell.z + dz)).map(([dx, dz]) => ({
        cell,
        dx,
        dz,
      })),
    );
  const geometry = new THREE.PlaneGeometry(2.4, 1.2);

  WALL_MESSAGES.forEach((text) => {
    const [{ cell, dx, dz }] = faces.splice(Math.floor(rng() * faces.length), 1);
    const { x, z } = cellToWorld(cell);
    const decal = new THREE.Mesh(geometry, decalMaterial(createMessageTexture(text, rng)));
    decal.position.set(x + dx * (CELL_SIZE / 2 - 0.01), 1.7, z + dz * (CELL_SIZE / 2 - 0.01));
    decal.rotation.y = Math.atan2(-dx, -dz); // face back into the room
    scene.add(decal);
  });
}

/** Warm light, tinted a little toward the room it hangs in. @param {import('../level/level.js').Room | null} room */
function lampColor(room) {
  const color = new THREE.Color(LAMP_COLOR);
  return room ? color.lerp(new THREE.Color(room.color), LAMP_ROOM_TINT) : color;
}

/** @param {THREE.Scene} scene @param {import('../level/level.js').Cell} cell @param {boolean} isBroken @param {THREE.Color} color */
function createLamp(scene, cell, isBroken, color) {
  const { x, z } = cellToWorld(cell);
  const material = new THREE.MeshStandardMaterial({
    color: 0x222222,
    emissive: 0xffd9a0,
    emissiveIntensity: LAMP_GLOW,
  });
  const fixture = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.3), material);
  fixture.position.set(x, WALL_HEIGHT - 0.04, z);
  const light = new THREE.PointLight(color, LAMP_INTENSITY, LAMP_RANGE, 2);
  light.position.set(x, WALL_HEIGHT - 0.4, z);
  scene.add(fixture, light);

  let isOn = true;
  let timer = 0;
  return {
    update(dt) {
      timer -= dt;
      if (timer > 0) return;
      isOn = !isOn;
      timer = isOn
        ? isBroken
          ? 0.05 + Math.random() * 0.6
          : 2 + Math.random() * 6
        : isBroken
          ? 0.05 + Math.random() * 0.3
          : 0.05 + Math.random() * 0.1;
      const level = isOn ? 1 : LAMP_DIM;
      light.intensity = LAMP_INTENSITY * level;
      material.emissiveIntensity = LAMP_GLOW * level;
    },
  };
}

function createExitDoor(scene, colliders, level) {
  const { x, z } = cellToWorld(level.exit);
  const [dx, dz] = DIRECTIONS.find(([ddx, ddz]) => isWalkable(level, level.exit.x + ddx, level.exit.z + ddz)) ?? [
    -1, 0,
  ];

  const door = new THREE.Mesh(
    new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT, CELL_SIZE),
    new THREE.MeshStandardMaterial({ color: 0x3b1d16, metalness: 0.6, roughness: 0.5 }),
  );
  door.position.set(x, WALL_HEIGHT / 2, z);
  door.castShadow = door.receiveShadow = true;

  const face = CELL_SIZE / 2 + 0.02;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 0.36),
    new THREE.MeshBasicMaterial({ map: createExitSignTexture() }),
  );
  sign.position.set(x + dx * face, WALL_HEIGHT - 0.4, z + dz * face);
  sign.rotation.y = Math.atan2(dx, dz);
  const signGlow = new THREE.PointLight(0x30ff60, 2, 5, 2);
  signGlow.position.set(x + dx * (face + 0.4), WALL_HEIGHT - 0.5, z + dz * (face + 0.4));

  // Moonlight waiting outside, off until the door opens.
  const outside = new THREE.PointLight(0xbfd4ff, 0, 16, 1.5);
  outside.position.set(x - dx * CELL_SIZE, 2, z - dz * CELL_SIZE);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CELL_SIZE * 3, CELL_SIZE * 3),
    new THREE.MeshStandardMaterial({ color: 0x1d2a1a, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(x - dx * CELL_SIZE * 2, 0, z - dz * CELL_SIZE * 2);

  scene.add(door, sign, signGlow, outside, ground);
  const collider = cellCollider(level.exit);
  colliders.push(collider);

  let isOpening = false;
  return {
    open() {
      isOpening = true;
      const index = colliders.indexOf(collider);
      if (index >= 0) colliders.splice(index, 1);
    },
    update(dt) {
      if (!isOpening) return;
      door.position.y = Math.min(door.position.y + DOOR_OPEN_SPEED * dt, WALL_HEIGHT * 1.5);
      outside.intensity = THREE.MathUtils.damp(outside.intensity, EXIT_LIGHT_INTENSITY, 1.5, dt);
    },
  };
}
