import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const SWAY_STRENGTH = 0.0003;
const MAX_SWAY = 0.04;
const CROUCH_LOWER = 0.03;
const LENS_COLOR = new THREE.Color(0xfff3d6);
const HAND_LIGHT_INTENSITY = 0.6;
const HAND_LIGHT_RANGE = 0.8; // reaches the hand and torch, not the walls
const LENS_GLOW = 10; // lens brightness when on, high enough to pass the bloom threshold
const HIDDEN_LAYER = 1; // the camera renders layer 0 only
const HAND_MODEL_OFFSET = new THREE.Vector3(0.03, -0.01, -0.31); // wrist position on the forearm; tweak to fit the grip
const TORCH_POSITION = new THREE.Vector3(0, 0.065, -0.42); // in the right fist; the mirrored left fist holds the item here
const BOX_GRIP = new THREE.Vector3(0, 0, -0.38); // the box hand's centre, until the hand model loads
const HELD_RADIUS = 0.028; // m; a wider item shrinks to about the hole of the fist
const LOWERED_DROP = 0.4; // m the empty left hand sinks, out of view
const LIFT_RATE = 10;

/**
 * First-person arms attached to the camera: the right hand holds the flashlight, the left one the selected bag item
 * (lowered out of view while that slot is empty). Walk bob and mouse sway.
 */
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

    /** Where the selected bag item sits in the left hand. */
    this.itemMount = new THREE.Object3D();
    this.itemMount.position.copy(BOX_GRIP);
    leftArm.add(this.itemMount);
    this.leftRest = leftArm.position.clone();
    this.leftLift = 0; // 0 = lowered out of view, 1 = raised
    leftArm.position.y = this.leftRest.y - LOWERED_DROP;
    /** @type {import('../items/pickups.js').Pickup | null} */
    this.heldItem = null;
    /** @type {THREE.Object3D | null} */
    this.heldMesh = null;
    this.isShown = true;

    this.lensMaterial = new THREE.MeshBasicMaterial({ color: LENS_COLOR });
    const torch = createFlashlightModel(this.lensMaterial);
    torch.position.copy(TORCH_POSITION);
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
   * Swaps the box hands for a loaded hand model: the right one grips the flashlight, a mirrored copy the bag item.
   * @param {THREE.Object3D} model wrist at the origin, fingers along -Z
   */
  setHandModel(model) {
    [this.rightArm, this.leftArm].forEach((arm) => {
      arm.userData.hand.visible = false;
      arm.userData.forearm.visible = false; // the box sleeve looked like a bar stuck to the wrist
    });
    model.position.copy(HAND_MODEL_OFFSET);
    this.rightArm.add(model);

    // Mirrored, the right hand becomes a left one closed the same way, around the item instead of the torch.
    const mirrored = new THREE.Group();
    mirrored.scale.x = -1;
    mirrored.add(cloneSkinned(model));
    this.leftArm.add(mirrored);
    this.itemMount.position.copy(TORCH_POSITION);
    this.setShown(this.isShown);
  }

  /**
   * Puts the selected bag item in the left hand; with nothing selected the hand sinks out of view.
   * @param {import('../items/pickups.js').Pickup | null} item
   */
  hold(item) {
    if (item === this.heldItem) return;
    this.heldItem = item;
    if (this.heldMesh) this.itemMount.remove(this.heldMesh);
    this.heldMesh = item ? createHeldMesh(item.mesh) : null;
    if (!this.heldMesh) return;
    this.itemMount.add(this.heldMesh);
    this.setShown(this.isShown);
  }

  /**
   * Shows or hides the arms and torch by moving their meshes to a layer the camera does not render. Setting
   * `root.visible = false` also hid the hand light: the light count changed and every shader recompiled (a hitch
   * each time the player climbed into a locker or got grabbed).
   * @param {boolean} isShown
   */
  setShown(isShown) {
    this.isShown = isShown;
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh) object.layers.set(isShown ? 0 : HIDDEN_LAYER);
    });
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

    this.leftLift = damp(this.leftLift, this.heldMesh ? 1 : 0, LIFT_RATE, dt);
    this.leftArm.position.y = this.leftRest.y - (1 - this.leftLift) * LOWERED_DROP;
  }
}

/**
 * A copy of a bag item's mesh for the hand: upright items lie along the fist's hole, pointing forward.
 * @param {THREE.Object3D} source shares its geometry and materials
 */
function createHeldMesh(source) {
  const mesh = source.clone();
  mesh.position.set(0, 0, 0);
  mesh.quaternion.identity(); // the pose it was found in on the floor
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  mesh.position.copy(box.getCenter(new THREE.Vector3())).negate();

  const holder = new THREE.Group();
  holder.rotation.x = -Math.PI / 2; // +Y (the item's top) to -Z
  holder.scale.setScalar(Math.min(1, HELD_RADIUS / (Math.max(size.x, size.z) / 2)));
  holder.add(mesh);
  return holder;
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
