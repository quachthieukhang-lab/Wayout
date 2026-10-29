import * as THREE from 'three';
import { Easing } from '@tweenjs/tween.js';

const FACE_FROM_TOP = 0.12; // face height as a fraction of the model height, measured from the top

/** @typedef {{ fromDistance: number, toDistance: number, fov: number, shake: number, rise: number, zoomTime: number, duration: number }} Shot */

/** @type {Readonly<Shot>} */
export const JUMPSCARE_SHOT = Object.freeze({
  fromDistance: 1.6,
  toDistance: 0.45,
  fov: 35,
  shake: 0.08,
  rise: 0.6,
  zoomTime: 0.35,
  duration: 2,
});

/** @param {number} duration how long the grab lasts at most (s) @returns {Readonly<Shot>} */
export function grabShot(duration) {
  return Object.freeze({
    fromDistance: 1.2,
    toDistance: 0.85,
    fov: 60,
    shake: 0.035,
    rise: 0.25,
    zoomTime: 0.25,
    duration,
  });
}

/** The camera work shared by the grab and the jumpscare: the monster's face filling the screen. */
export class CloseUp {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {import('../player/player.js').Player} player
   * @param {import('../monster/monster.js').Monster} monster
   * @param {{ setShown: (isShown: boolean) => void }} viewModel
   */
  constructor(camera, player, monster, viewModel) {
    this.camera = camera;
    this.player = player;
    this.monster = monster;
    this.viewModel = viewModel;
    this._cameraBase = new THREE.Vector3();
    this._forward = { x: 0, z: -1 };
    this._faceHeight = 0;
    this.startFov = camera.fov;
  }

  /** Turns player and monster to face each other along the line between them, then measures its face. */
  start() {
    const dx = this.monster.position.x - this.player.position.x;
    const dz = this.monster.position.z - this.player.position.z;
    const length = Math.hypot(dx, dz) || 1;
    this._forward = { x: dx / length, z: dz / length };

    // Same formula for both: player forward is (-sin, -cos), the monster model faces (sin, cos).
    const yaw = Math.atan2(-this._forward.x, -this._forward.z);
    this.player.yaw = yaw;
    this.player.pitch = 0;
    this.monster.yaw = yaw;
    this.monster.object.rotation.y = yaw;
    this.monster.body.rotation.set(0, 0, 0); // no lean, so the face stays where we aim

    const box = new THREE.Box3().setFromObject(this.monster.body);
    this._faceHeight = box.max.y - (box.max.y - box.min.y) * FACE_FROM_TOP;
    this._cameraBase.copy(this.camera.position);
    this.startFov = this.camera.fov;
    this.viewModel.setShown(false); // arms and flashlight would block the face
  }

  /** Lunge + zoom: the monster closes in, the lens narrows and rises to its face, the view shakes. @param {Shot} shot @param {number} time */
  frame(shot, time) {
    const { lerp } = THREE.MathUtils;
    const ease = Easing.Cubic.Out(Math.min(time / shot.zoomTime, 1)); // fast in, then settles on the face

    const distance = lerp(shot.fromDistance, shot.toDistance, ease);
    const base = this._cameraBase;
    this.monster.position.set(base.x + this._forward.x * distance, 0, base.z + this._forward.z * distance);

    this.camera.fov = lerp(this.startFov, shot.fov, ease);
    this.camera.updateProjectionMatrix();

    const shake = Math.max(0, 1 - time / shot.duration) * shot.shake;
    const jitter = () => (Math.random() - 0.5) * shake;
    const eyeY = lerp(base.y, this._faceHeight, ease * shot.rise);
    this.camera.position.set(base.x + jitter(), eyeY + jitter(), base.z + jitter());
    this.camera.lookAt(this.monster.position.x, this._faceHeight, this.monster.position.z);
  }

  /** Back to the player's own view after breaking free. */
  end() {
    this.viewModel.setShown(true);
    this.camera.fov = this.startFov;
    this.camera.updateProjectionMatrix();
  }
}
