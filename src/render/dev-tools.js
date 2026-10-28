import Stats from 'three/addons/libs/stats.module.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';

/**
 * FPS meter and a tuning panel for the look of the game. main.js loads this only under `npm run dev`,
 * so none of it ends up in the production build. Values found here go back into the constants by hand.
 * @param {{ graphics: ReturnType<typeof import('./graphics.js').createGraphics>,
 *   flashlight: import('../player/flashlight.js').Flashlight, scene: import('three').Scene }} parts
 * @returns {{ begin: () => void, end: () => void }} wrap each frame's work
 */
export function createDevTools({ graphics, flashlight, scene }) {
  const stats = new Stats();
  document.body.appendChild(stats.dom);

  const gui = new GUI({ title: 'Dev tuning' }).close();
  const { bloom } = graphics;
  const bloomFolder = gui.addFolder('Bloom');
  bloomFolder.add(bloom, 'intensity', 0, 3, 0.05);
  bloomFolder.add(bloom.luminanceMaterial, 'threshold', 0, 15, 0.1);
  bloomFolder.add(bloom.luminanceMaterial, 'smoothing', 0, 5, 0.05);
  bloomFolder.add(bloom.mipmapBlurPass, 'radius', 0, 1, 0.05);

  // Intensity is rewritten every frame by the battery logic, so only the shape of the beam is tunable here.
  const beamFolder = gui.addFolder('Flashlight beam');
  beamFolder.add(flashlight.light, 'angle', 0.2, 1.2, 0.01);
  beamFolder.add(flashlight.light, 'penumbra', 0, 1, 0.01);
  beamFolder.add(flashlight.light, 'decay', 0, 2.5, 0.05);

  gui.add(/** @type {import('three').FogExp2} */ (scene.fog), 'density', 0, 0.2, 0.005).name('Fog density');

  return { begin: () => stats.begin(), end: () => stats.end() };
}
