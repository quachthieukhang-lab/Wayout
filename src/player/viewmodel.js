import * as THREE from 'three';

const SWAY_STRENGTH = 0.0003;
const MAX_SWAY = 0.04;
const CROUCH_LOWER = 0.03;
const LENS_COLOR = new THREE.Color(0xfff3d6);
const HAND_LIGHT_INTENSITY = 0.6;
const HAND_LIGHT_RANGE = 0.8; // reaches the hand and torch, not the walls
const LENS_GLOW = 10; // lens brightness when on, high enough to pass the bloom threshold
const HAND_MODEL_OFFSET = new THREE.Vector3(0.03, -0.01, -0.31); // wrist position on the forearm; tweak to fit the grip

/** First-person arms attached to the camera; the right hand holds the flashlight. Walk bob and mouse sway. */
export class ViewModel {
  /** @param {THREE.Camera} camera */
  constructor(camera) {
    this.root = new THREE.Group();
    camera.add(this.root);

    const skin = new THREE.MeshStandardMaterial({ color: 0xc69c7a, roughness: 0.8 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.95 });
    const rightArm = createArm(skin, sleeve, 1);
    const leftArm = createArm(skin, sleeve, -1);
    leftArm.position.y -= 0.06;
    this.root.add(rightArm, leftArm);
    this.rightArm = rightArm;
    this.leftArm = leftArm;

    this.lensMaterial = new THREE.MeshBasicMaterial({ color: LENS_COLOR });
    const torch = createFlashlightModel(this.lensMaterial);
    torch.position.set(0, 0.065, -0.42);
    rightArm.add(torch);

    /** Where the flashlight's SpotLight is attached (points down -Z). */
    this.flashlightMount = new THREE.Object3D();
    this.flashlightMount.position.z = -0.15;
    torch.add(this.flashlightMount);

    // Faint spill so the hands are not pitch black. Decay 0: with 1/d² the fingers, a few cm away, burned white and bloomed.
    this.handLight = new THREE.PointLight(0xfff0d0, HAND_LIGHT_INTENSITY, HAND_LIGHT_RANGE, 0);
    this.handLight.position.set(0, 0.05, -0.2);
    torch.add(this.handLight);

    this.sway = new THREE.Vector2();
  }

  /** @param {number} dx @param {number} dy mouse movement in pixels */
  addSway(dx, dy) {
    const { clamp } = THREE.MathUtils;
    this.sway.x = clamp(this.sway.x - dx * SWAY_STRENGTH, -MAX_SWAY, MAX_SWAY);
    this.sway.y = clamp(this.sway.y + dy * SWAY_STRENGTH, -MAX_SWAY, MAX_SWAY);
  }

  /**
   * Swaps the box hand for a loaded hand model gripping the flashlight; the free left arm is hidden.
   * @param {THREE.Object3D} model wrist at the origin, fingers along -Z
   */
  setHandModel(model) {
    this.rightArm.userData.hand.visible = false;
    this.rightArm.userData.forearm.visible = false; // the box sleeve looked like a bar stuck to the wrist
    this.leftArm.visible = false;
    model.position.copy(HAND_MODEL_OFFSET);
    this.rightArm.add(model);
  }

  /** @param {number} brightness 0..1 */
  setLensGlow(brightness) {
    this.lensMaterial.color.copy(LENS_COLOR).multiplyScalar((0.08 + 0.92 * brightness) * LENS_GLOW);
    this.handLight.intensity = HAND_LIGHT_INTENSITY * brightness;
  }

  /** @param {number} dt @param {import('./player.js').Player} player */
  update(dt, player) {
    const { damp, clamp } = THREE.MathUtils;
    this.sway.x = damp(this.sway.x, 0, 6, dt);
    this.sway.y = damp(this.sway.y, 0, 6, dt);

    const w = player.bobWeight;
    const bobX = Math.cos(player.bobPhase) * 0.012 * w;
    const bobY = -Math.abs(Math.sin(player.bobPhase)) * 0.018 * w;
    const airLift = clamp(-player.velocity.y * 0.004, -0.04, 0.04);
    const crouch = player.isCrouching ? -CROUCH_LOWER : 0;

    this.root.position.set(bobX + this.sway.x, bobY + airLift + crouch + this.sway.y, 0);
  }
}

function createArm(skin, sleeve, side) {
  const arm = new THREE.Group();

  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.45), sleeve);
  forearm.position.z = -0.1;

  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.12), skin);
  hand.position.z = -0.38;

  arm.add(forearm, hand);
  arm.userData.hand = hand;
  arm.userData.forearm = forearm;
  arm.position.set(side * 0.22, -0.22, -0.3);
  arm.rotation.set(0.1, side * 0.12, 0);
  return arm;
}

/** Small torch pointing down -Z. */
function createFlashlightModel(lensMaterial) {
  const metal = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, metalness: 0.7, roughness: 0.4 });
  const torch = new THREE.Group();

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 12), metal);
  body.rotation.x = Math.PI / 2;

  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.024, 0.05, 12), metal);
  head.rotation.x = Math.PI / 2;
  head.position.z = -0.12;

  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.028, 16), lensMaterial);
  lens.rotation.y = Math.PI;
  lens.position.z = -0.146;

  torch.add(body, head, lens);
  return torch;
}
