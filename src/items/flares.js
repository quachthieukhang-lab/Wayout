import * as THREE from 'three';

export const FLARE_BURN_TIME = 25; // s
export const FLARE_LURE_RADIUS = 18; // m its hiss and glow carry, like a noise
export const FLARE_DAZZLE_DISTANCE = 3; // m: closer than this, the glare blinds it once
const LURE_INTERVAL = 2.5; // s between pulses of its pull
const LIGHT_COLOR = 0xff3a22;
const LIGHT_INTENSITY = 16;
const LIGHT_RANGE = 12;
const LIGHT_HEIGHT = 0.3; // above the stick, so the floor around it is lit
const FADE_TIME = 3; // s it sputters out at the end

/**
 * @typedef {{ item: import('./pickups.js').Pickup, timeLeft: number, pulseTimer: number, hasDazzled: boolean }} Burning
 */

/**
 * The one lit flare: a red light that follows the stick wherever it flies or lies. The light exists from the start at
 * intensity 0 (adding a light later would recompile every shader, a visible hitch); a new flare snuffs the old one.
 */
export class Flares {
  /** @param {THREE.Object3D} scene */
  constructor(scene) {
    this.scene = scene;
    this.light = new THREE.PointLight(LIGHT_COLOR, 0, LIGHT_RANGE, 2);
    scene.add(this.light);
    /** @type {Burning | null} */
    this.burning = null;
    this._flicker = 0;
  }

  /** @returns {THREE.Vector3 | null} where the lit flare is */
  get position() {
    return this.burning?.item.mesh.position ?? null;
  }

  /** Strikes a flare that is about to be thrown. @param {import('./pickups.js').Pickup} item */
  ignite(item) {
    if (this.burning) this.burnOut();
    this.burning = { item, timeLeft: FLARE_BURN_TIME, pulseTimer: 0, hasDazzled: false };
  }

  /**
   * @param {number} dt
   * @returns {{ lure: THREE.Vector3 | null }} `lure`: where it pulls the monster this frame
   */
  update(dt) {
    const burning = this.burning;
    if (!burning) return { lure: null };
    burning.timeLeft -= dt;
    if (burning.timeLeft <= 0) {
      this.burnOut();
      return { lure: null };
    }
    const { position } = burning.item.mesh;
    this.light.position.set(position.x, position.y + LIGHT_HEIGHT, position.z);
    this._flicker += dt * 23;
    const fade = Math.min(burning.timeLeft / FADE_TIME, 1);
    this.light.intensity =
      LIGHT_INTENSITY * fade * (0.8 + 0.2 * Math.sin(this._flicker) * Math.sin(this._flicker * 0.37));

    burning.pulseTimer -= dt;
    if (burning.pulseTimer > 0) return { lure: null };
    burning.pulseTimer = LURE_INTERVAL;
    return { lure: position };
  }

  /**
   * The glare blinds whatever comes close, once per flare.
   * @param {{ x: number, z: number }} point the monster
   * @returns {boolean} whether it was dazzled just now
   */
  dazzles(point) {
    const burning = this.burning;
    if (!burning || burning.hasDazzled) return false;
    const { position } = burning.item.mesh;
    if (Math.hypot(point.x - position.x, point.z - position.z) > FLARE_DAZZLE_DISTANCE) return false;
    burning.hasDazzled = true;
    return true;
  }

  /** The stick is spent: the light goes out and the stick is gone. */
  burnOut() {
    if (!this.burning) return;
    this.scene.remove(this.burning.item.mesh);
    this.burning = null;
    this.light.intensity = 0;
  }
}
