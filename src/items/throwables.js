import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PickupType, THROWABLE_SIZE } from './pickups.js';

export const MAX_CARRIED = 2;
export const THROW_SPEED = 12;
export const MIN_IMPACT_SPEED = 1.2; // softer touches make no sound
const THROW_LIFT = 2.5; // extra upward speed, so it flies in an arc
const THROW_SPIN = 8; // rad/s end over end
const HAND_REACH = 0.25; // starts this far ahead of the eye, about where the hand is
const GRAVITY = 18; // a bit stronger than 9.8: real arcs look floaty at this scale
const FIXED_STEP = 1 / 60;
const MAX_SUBSTEPS = 4;
const MAX_FLIGHT_TIME = 8; // seconds before it counts as resting wherever it is
const FELL_OUT_Y = -1; // below the floor: it flew out of the open exit and is gone
const SLEEP_SPEED = 0.25;
const SLEEP_TIME = 0.4;

/** How each throwable behaves: how far its noise carries, whether it smashes, and its weight (kg). */
export const THROWABLE = Object.freeze({
  [PickupType.BOTTLE]: Object.freeze({ noiseRadius: 20, breaks: true, mass: 0.45 }),
  [PickupType.CAN]: Object.freeze({ noiseRadius: 13, breaks: false, mass: 0.1 }), // quieter, but reusable
});

/**
 * @typedef {import('./pickups.js').Pickup} Pickup
 * @typedef {{ item: Pickup, position: THREE.Vector3, speed: number, isFirst: boolean, breaks: boolean }} Impact
 * @typedef {{ item: Pickup, body: CANNON.Body, time: number, hardestHit: number, hasHit: boolean }} Flight
 */

/**
 * The bottles and cans the player carries, and the ones in the air. Flight, bounces and tumbling come from a
 * cannon-es world that mirrors the level's static colliders; it only steps while something is flying.
 */
export class Throwing {
  /** @param {THREE.Object3D} scene @param {THREE.Box3[]} colliders */
  constructor(scene, colliders) {
    this.scene = scene;
    this.colliders = colliders;
    /** @type {Pickup[]} the last one is thrown first */
    this.carried = [];
    /** @type {Flight[]} */
    this.flying = [];

    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -GRAVITY, 0), allowSleep: true });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world); // hundreds of static wall boxes
    this.world.defaultContactMaterial.restitution = 0.3;
    this.world.defaultContactMaterial.friction = 0.4;
    /** @type {Map<THREE.Box3, CANNON.Body>} */
    this.staticBodies = new Map(colliders.map((box) => [box, this.addStaticBox(box)]));

    this._direction = new THREE.Vector3();
    this._origin = new THREE.Vector3();
  }

  get canCarryMore() {
    return this.carried.length < MAX_CARRIED;
  }

  /** @param {Pickup} item already taken out of the world */
  carry(item) {
    this.carried.push(item);
  }

  /**
   * Throws the last item picked up along the view, adding the player's own movement.
   * @param {THREE.Camera} camera
   * @param {{ x: number, z: number }} playerVelocity
   * @returns {Pickup | null} what was thrown, null with empty hands
   */
  throwFrom(camera, playerVelocity) {
    const item = this.carried.pop();
    if (!item) return null;
    const direction = camera.getWorldDirection(this._direction);
    const origin = camera.getWorldPosition(this._origin).addScaledVector(direction, HAND_REACH);
    const { radius, height } = THROWABLE_SIZE[item.type];

    const body = new CANNON.Body({
      mass: THROWABLE[item.type].mass,
      shape: new CANNON.Cylinder(radius, radius, height, 10),
      position: new CANNON.Vec3(origin.x, origin.y, origin.z),
      velocity: new CANNON.Vec3(
        direction.x * THROW_SPEED + playerVelocity.x,
        direction.y * THROW_SPEED + THROW_LIFT,
        direction.z * THROW_SPEED + playerVelocity.z,
      ),
      // Tumbles end over end: spin around the horizontal axis across the throw.
      angularVelocity: new CANNON.Vec3(-direction.z * THROW_SPIN, 0, direction.x * THROW_SPIN),
      sleepSpeedLimit: SLEEP_SPEED,
      sleepTimeLimit: SLEEP_TIME,
    });
    /** @type {Flight} */
    const flight = { item, body, time: 0, hardestHit: 0, hasHit: false };
    body.addEventListener('collide', (/** @type {{ contact: CANNON.ContactEquation }} */ event) => {
      flight.hardestHit = Math.max(flight.hardestHit, Math.abs(event.contact.getImpactVelocityAlongNormal()));
    });
    this.world.addBody(body);
    this.flying.push(flight);

    item.mesh.position.copy(origin);
    this.scene.add(item.mesh);
    return item;
  }

  /**
   * Moves everything in the air. A bottle smashes on its first hard impact; anything else lands and comes to rest.
   * @param {number} dt
   * @returns {{ impacts: Impact[], rested: Pickup[] }}
   */
  update(dt) {
    /** @type {Impact[]} */
    const impacts = [];
    /** @type {Pickup[]} */
    const rested = [];
    if (this.flying.length === 0) return { impacts, rested };

    this.removeOpenedColliders();
    this.world.step(FIXED_STEP, dt, MAX_SUBSTEPS);
    this.flying = this.flying.filter((flight) => {
      const { item, body } = flight;
      flight.time += dt;
      item.mesh.position.set(body.position.x, body.position.y, body.position.z);
      item.mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);

      if (body.position.y < FELL_OUT_Y) {
        this.world.removeBody(body);
        this.scene.remove(item.mesh);
        return false;
      }
      const speed = flight.hardestHit;
      flight.hardestHit = 0;
      if (speed >= MIN_IMPACT_SPEED) {
        const { breaks } = THROWABLE[item.type];
        impacts.push({ item, position: item.mesh.position.clone(), speed, isFirst: !flight.hasHit, breaks });
        flight.hasHit = true;
        if (breaks) {
          this.world.removeBody(body);
          this.scene.remove(item.mesh);
          return false;
        }
      }
      if (body.sleepState !== CANNON.Body.SLEEPING && flight.time < MAX_FLIGHT_TIME) return true;
      this.world.removeBody(body);
      rested.push(item);
      return false;
    });
    return { impacts, rested };
  }

  /** @param {THREE.Box3} box */
  addStaticBox(box) {
    const size = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const center = box.getCenter(new THREE.Vector3());
    const body = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(new CANNON.Vec3(size.x, size.y, size.z)),
      position: new CANNON.Vec3(center.x, center.y, center.z),
    });
    this.world.addBody(body);
    return body;
  }

  /** The exit door's box leaves the colliders when it opens; its physics twin has to go too. */
  removeOpenedColliders() {
    if (this.staticBodies.size === this.colliders.length) return;
    const current = new Set(this.colliders);
    for (const [box, body] of this.staticBodies) {
      if (current.has(box)) continue;
      this.world.removeBody(body);
      this.staticBodies.delete(box);
    }
  }
}
