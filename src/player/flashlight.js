import * as THREE from 'three';

const MAX_INTENSITY = 32;
const RANGE = 24;
const CONE_ANGLE = 0.5;
const PENUMBRA = 0.85; // soft, gradual edge instead of a hard disc
const DECAY = 1.5;
const SHADOW_BLUR = 2;
const AIM_DISTANCE = 20; // the beam converges on the crosshair this far ahead
// Just below/right of the eye, inside the player's collision radius so it can never poke through a wall.
const CAMERA_OFFSET = new THREE.Vector3(0.12, -0.1, 0);

const DRAIN_PER_SECOND = 1 / 150; // a full battery lasts 2.5 minutes
const LOW_BATTERY = 0.2;
const RANDOM_FLICKER_CHANCE = 0.0015; // per frame, even with a good battery

const BURST_COST = 0.2; // battery spent per flash burst
const BURST_DURATION = 0.35;
const BURST_COOLDOWN = 6;
const BURST_BRIGHTNESS = 4;

/** Hand-held spotlight with a draining battery that flickers when low. */
export class Flashlight {
  /** @param {() => number} [rng] */
  constructor(rng = Math.random) {
    this.rng = rng;
    this.battery = 1;
    this.drainScale = 1; // difficulty
    this.isOn = true;
    this.flickerTime = 0;
    this.burstTime = 0;
    this.burstCooldown = 0;

    this.light = new THREE.SpotLight(0xfff0d0, MAX_INTENSITY, RANGE, CONE_ANGLE, PENUMBRA, DECAY);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.camera.near = 0.05;
    this.light.shadow.camera.far = RANGE;
    this.light.shadow.bias = -0.0005;
    this.light.shadow.normalBias = 0.02; // stops speckled shadow acne on walls lit up close
    this.light.shadow.radius = SHADOW_BLUR;
    this.light.target.position.set(0, 0, -1);
    this.light.add(this.light.target);
  }

  /**
   * Mounts the light at the camera, aimed at the screen center. (Mounted in the hand, it sat ~0.6 m ahead
   * of the eye and went through walls the player stood against, shattering the beam and its shadows.)
   * @param {THREE.Camera} camera
   */
  attachTo(camera) {
    camera.add(this.light, this.light.target);
    this.light.position.copy(CAMERA_OFFSET);
    this.light.target.position.set(0, 0, -AIM_DISTANCE);
  }

  /** @returns {boolean} whether the light is now on */
  toggle() {
    this.isOn = !this.isOn && this.battery > 0;
    return this.isOn;
  }

  /**
   * A blinding flash that can stun the monster. Costs battery and has a cooldown.
   * @returns {boolean} whether the burst fired
   */
  burst() {
    if (!this.isOn || this.burstCooldown > 0 || this.battery < BURST_COST) return false;
    this.battery -= BURST_COST;
    this.burstTime = BURST_DURATION;
    this.burstCooldown = BURST_COOLDOWN;
    return true;
  }

  /** @param {number} amount 0..1 */
  recharge(amount) {
    this.battery = Math.min(this.battery + amount, 1);
  }

  /** 0..1 brightness this frame, for the lens glow. */
  get brightness() {
    return this.light.intensity / MAX_INTENSITY;
  }

  /** @param {number} dt */
  update(dt) {
    this.burstCooldown = Math.max(this.burstCooldown - dt, 0);
    if (this.burstTime > 0) {
      this.burstTime -= dt;
      this.light.intensity = MAX_INTENSITY * BURST_BRIGHTNESS;
      return;
    }
    if (this.isOn) {
      this.battery = Math.max(this.battery - DRAIN_PER_SECOND * this.drainScale * dt, 0);
      if (this.battery === 0) this.isOn = false;
    }
    // Intensity 0 instead of `visible = false`: toggling lights forces a shader recompile (a visible hitch).
    this.light.intensity = this.isOn ? MAX_INTENSITY * this.flicker(dt) : 0;
  }

  flicker(dt) {
    const isLow = this.battery < LOW_BATTERY;
    if (this.flickerTime <= 0 && this.rng() < (isLow ? RANDOM_FLICKER_CHANCE * 20 : RANDOM_FLICKER_CHANCE)) {
      this.flickerTime = 0.15 + this.rng() * 0.5;
    }
    if (this.flickerTime <= 0) return isLow ? 0.55 + this.battery * 2 : 1;

    this.flickerTime -= dt;
    return this.rng() < 0.5 ? 0.05 : 0.6;
  }
}
