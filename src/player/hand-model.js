import * as THREE from 'three';
import { fetchGltf } from '../render/gltf.js';

// "Rigged hand" by Elena FF (https://sketchfab.com/elenaferfor), licensed under CC BY-SA 4.0
export const HAND_MODEL_URL = '/models/hand.glb';
const HAND_LENGTH = 0.28; // wrist to fingertips, metres (oversized on purpose so it reads well on screen)
const GRIP_TIME_FRACTION = 0.5; // point in the Open/Close clip where the fist is closed
const HAND_ROLL = Math.PI; // extra spin around the forearm; this model came out upside down without it
// GLTFLoader strips "." from node names ("hand.R_02" becomes "handR_02"), so the dot is optional.
const WRIST_BONE = /^hand\.?R_/;
const FINGERTIP_BONE = /^(index|middle|ring|pinky)_tip\.?R_end/;
const THUMB_TIP_BONE = /^thumb_tip\.?R_end/;

/**
 * Loads the rigged right hand, posed as a fist.
 * @returns {Promise<THREE.Object3D | null>} wrist at the origin, fingers along -Z, thumb up; null if no file
 */
export async function loadHandModel(url = HAND_MODEL_URL) {
  const gltf = await fetchGltf(url);
  if (!gltf) return null;

  const { scene } = gltf;
  const strays = [];
  scene.traverse((node) => {
    if (node instanceof THREE.Light || node instanceof THREE.Camera) strays.push(node); // exported along with the model
    if (node instanceof THREE.SkinnedMesh) node.frustumCulled = false;
  });
  strays.forEach((node) => node.removeFromParent());

  const hand = orientHand(scene); // measured in the open rest pose, before gripping
  if (gltf.animations.length > 0) poseGrip(scene, gltf.animations[0]);
  return hand;
}

function poseGrip(scene, clip) {
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip).play();
  action.paused = true;
  action.time = clip.duration * GRIP_TIME_FRACTION;
  mixer.update(0);
}

function orientHand(scene) {
  scene.updateMatrixWorld(true);
  const bones = [];
  scene.traverse((node) => {
    if (node.isBone) bones.push(node);
  });
  const worldOf = (bone) => bone.getWorldPosition(new THREE.Vector3());
  const wrist = bones.find((bone) => WRIST_BONE.test(bone.name));
  const thumb = bones.find((bone) => THUMB_TIP_BONE.test(bone.name));
  const tips = bones.filter((bone) => FINGERTIP_BONE.test(bone.name));
  if (!wrist || !thumb || tips.length === 0)
    throw new Error('Hand model is missing its wrist, thumb or fingertip bones');

  const wristPosition = worldOf(wrist);
  const toTips = tips
    .reduce((sum, bone) => sum.add(worldOf(bone)), new THREE.Vector3())
    .divideScalar(tips.length)
    .sub(wristPosition);
  const length = toTips.length();

  scene.position.sub(wristPosition);
  const aligned = new THREE.Group();
  aligned.quaternion.setFromUnitVectors(toTips.divideScalar(length), new THREE.Vector3(0, 0, -1));
  aligned.scale.setScalar(HAND_LENGTH / length);
  aligned.add(scene);

  // Roll around the finger axis so the thumb points up (palm faces left for a right hand).
  const thumbDirection = worldOf(thumb).sub(wristPosition).applyQuaternion(aligned.quaternion);
  const pivot = new THREE.Group();
  pivot.rotation.z = Math.atan2(thumbDirection.x, thumbDirection.y) + HAND_ROLL;
  pivot.add(aligned);
  return pivot;
}
