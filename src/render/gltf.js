import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// The models are packed with `gltf-transform optimize` (meshopt geometry, WebP textures); see `npm run models`.
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

/**
 * Fetches and parses a .glb file.
 * @param {string} url
 * @returns {Promise<import('three/addons/loaders/GLTFLoader.js').GLTF | null>} null when the file does not exist
 */
export async function fetchGltf(url) {
  const response = await fetch(url);
  const contentType = response.headers.get('content-type') ?? '';
  // The Vite dev server answers missing files with index.html, so check the type too.
  if (!response.ok || contentType.includes('text/html')) return null;
  return loader.parseAsync(await response.arrayBuffer(), '');
}
