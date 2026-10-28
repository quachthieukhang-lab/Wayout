import * as THREE from 'three';
import { cellToWorld } from '../level/level.js';

export const RADIO_NOISE = 22; // m in the open; walls muffle it like any noise
export const PLAY_TIME = 6; // s of static and music
const COOLDOWN = 30; // s after it falls silent
const PULSE_INTERVAL = 2; // while it plays, it keeps drawing the monster in
const REACH = 1.8; // how close the player must stand to switch it on (m)
const CRATE_SIZE = 0.5;
const LED_GLOW = Object.freeze({ on: 6, off: 0.25 });

/**
 * @typedef {{
 *   cell: import('../level/level.js').Cell, position: THREE.Vector3, timeLeft: number, cooldown: number,
 *   pulseTimer: number, led: THREE.MeshStandardMaterial,
 * }} Radio
 */

/**
 * Old radios on crates (R). Switched on, one plays for a few seconds and lures the monster, then needs a long
 * rest: a lure the player can plan around, unlike a thrown bottle.
 * @param {THREE.Object3D} scene
 * @param {THREE.Box3[]} colliders
 * @param {import('../level/level.js').Level} level
 */
export function createRadios(scene, colliders, level) {
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 0.9 });
  const casing = new THREE.MeshStandardMaterial({ color: 0x2b2622, roughness: 0.7 });
  const grille = new THREE.MeshStandardMaterial({ color: 0x8a8070, metalness: 0.6, roughness: 0.4 });

  /** @type {Radio[]} */
  const radios = level.radios.map((cell) => {
    const { x, z } = cellToWorld(cell);
    const led = new THREE.MeshStandardMaterial({
      color: 0x220000,
      emissive: 0xff2010,
      emissiveIntensity: LED_GLOW.off,
    });
    scene.add(buildRadio(x, z, { wood, casing, grille, led }));
    const half = CRATE_SIZE / 2;
    colliders.push(
      new THREE.Box3(new THREE.Vector3(x - half, 0, z - half), new THREE.Vector3(x + half, CRATE_SIZE, z + half)),
    );
    return { cell, position: new THREE.Vector3(x, 0, z), timeLeft: 0, cooldown: 0, pulseTimer: 0, led };
  });

  return {
    radios,

    /** Closest radio within reach. @param {{ x: number, z: number }} position @returns {Radio | null} */
    findNear(position) {
      let best = null;
      let bestDistance = REACH;
      for (const radio of radios) {
        const distance = Math.hypot(position.x - radio.position.x, position.z - radio.position.z);
        if (distance < bestDistance) [best, bestDistance] = [radio, distance];
      }
      return best;
    },

    /** @param {Radio} radio @returns {boolean} false while it plays or rests */
    switchOn(radio) {
      if (radio.timeLeft > 0 || radio.cooldown > 0) return false;
      radio.timeLeft = PLAY_TIME;
      radio.pulseTimer = 0;
      return true;
    },

    /** @param {number} dt @returns {Radio[]} the radios sending out a pulse of noise this frame */
    update(dt) {
      const pulses = [];
      for (const radio of radios) {
        if (radio.timeLeft > 0) {
          radio.timeLeft -= dt;
          radio.pulseTimer -= dt;
          if (radio.pulseTimer <= 0) {
            radio.pulseTimer = PULSE_INTERVAL;
            pulses.push(radio);
          }
          if (radio.timeLeft <= 0) {
            radio.timeLeft = 0;
            radio.cooldown = COOLDOWN;
          }
        } else {
          radio.cooldown = Math.max(radio.cooldown - dt, 0);
        }
        radio.led.emissiveIntensity = radio.timeLeft > 0 ? LED_GLOW.on : LED_GLOW.off;
      }
      return pulses;
    },
  };
}

/** A crate with a small radio on top: casing, speaker grille, antenna and a power LED. */
function buildRadio(x, z, { wood, casing, grille, led }) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const crate = new THREE.Mesh(new THREE.BoxGeometry(CRATE_SIZE, CRATE_SIZE, CRATE_SIZE), wood);
  crate.position.y = CRATE_SIZE / 2;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.12), casing);
  body.position.y = CRATE_SIZE + 0.1;
  const speaker = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), grille);
  speaker.position.set(-0.07, CRATE_SIZE + 0.1, 0.061);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.35, 6), grille);
  antenna.position.set(0.13, CRATE_SIZE + 0.3, 0);
  antenna.rotation.z = -0.4;
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), led);
  light.position.set(0.1, CRATE_SIZE + 0.15, 0.062);
  [crate, body].forEach((mesh) => (mesh.castShadow = mesh.receiveShadow = true));
  group.add(crate, body, speaker, antenna, light);
  return group;
}
