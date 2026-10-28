import * as THREE from 'three';
import { fetchGltf } from '../render/gltf.js';

// "Smily horror monster" by Bento (https://sketchfab.com/gostbento), licensed under CC BY 4.0
export const MONSTER_MODEL_URL = '/models/monster.glb';
const TARGET_HEIGHT = 1.7; // about human height; taller models poke through the 3 m corridor walls
const MODEL_YAW_OFFSET = 0; // set to Math.PI if the model walks backwards, ±Math.PI / 2 if sideways

/**
 * Loads the GLB monster, scaled to TARGET_HEIGHT with its feet at y = 0, facing +Z.
 * If the file has animations, the first clip loops on `model.userData.mixer`.
 * @returns {Promise<THREE.Object3D | null>} null when no model file is present
 */
export async function loadMonsterModel(url = MONSTER_MODEL_URL) {
  const gltf = await fetchGltf(url);
  if (!gltf) return null;

  const model = normalizeModel(gltf.scene);
  if (gltf.animations.length > 0) {
    const mixer = new THREE.AnimationMixer(gltf.scene);
    mixer.clipAction(gltf.animations[0]).play();
    model.userData.mixer = mixer;
  }
  return model;
}

function normalizeModel(scene) {
  scene.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    if (node.isSkinnedMesh) node.frustumCulled = false; // animated bones can leave the bind-pose bounds
  });

  const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  scene.scale.setScalar(TARGET_HEIGHT / size.y);

  const box = new THREE.Box3().setFromObject(scene);
  const center = box.getCenter(new THREE.Vector3());
  scene.position.set(-center.x, -box.min.y, -center.z);

  const pivot = new THREE.Group();
  pivot.rotation.y = MODEL_YAW_OFFSET;
  pivot.add(scene);
  return pivot;
}

/** Fallback stalker built from primitives: tall, thin, glowing eyes. Faces +Z. */
export function createStalkerModel() {
  const skin = new THREE.MeshStandardMaterial({ color: 0x0d0c0c, roughness: 1 });
  const eyes = new THREE.MeshBasicMaterial({ color: 0xff2a10 });
  const model = new THREE.Group();

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.9, 4, 10), skin);
  torso.position.y = 1.55;
  torso.scale.z = 0.7;

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), skin);
  head.position.set(0, 2.3, 0.05);
  head.scale.set(0.9, 1.3, 1);
  head.rotation.z = 0.25;

  const eyeGeometry = new THREE.SphereGeometry(0.03, 8, 6);
  [-0.07, 0.07].forEach((x) => {
    const eye = new THREE.Mesh(eyeGeometry, eyes);
    eye.position.set(x, 0.03, 0.17);
    head.add(eye);
  });

  const limbGeometry = new THREE.CylinderGeometry(0.05, 0.035, 1.3, 6);
  limbGeometry.translate(0, -0.65, 0); // pivot at the shoulder / hip
  const limb = (x, y, rotX, rotZ) => {
    const mesh = new THREE.Mesh(limbGeometry, skin);
    mesh.position.set(x, y, 0);
    mesh.rotation.set(rotX, 0, rotZ);
    return mesh;
  };

  model.add(
    torso,
    head,
    limb(-0.3, 2.0, 0.2, 0.12),
    limb(0.3, 2.0, -0.1, -0.12),
    limb(-0.12, 1.1, 0, 0.04),
    limb(0.12, 1.1, 0, -0.04),
  );
  model.traverse((node) => {
    if (node instanceof THREE.Mesh) node.castShadow = true;
  });
  return model;
}
