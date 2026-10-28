import * as THREE from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';

// Bloom works on linear HDR colour before tone mapping. Walls in the flashlight beam reach ~2 at 1 m and ~6 up close,
// so the threshold sits above that: only the light sources themselves (lamp panels, the lens) glow.
const BLOOM = Object.freeze({ intensity: 0.5, radius: 0.6, luminanceThreshold: 6, luminanceSmoothing: 1 });
const MSAA_SAMPLES = 4; // render targets skip the canvas' antialias, so ask for it here

const QUALITY = Object.freeze({
  high: {
    maxPixelRatio: 1.5,
    isBloomOn: true,
    multisampling: MSAA_SAMPLES,
    flashlightShadow: 1024,
    castsEyeShadow: true,
  },
  low: { maxPixelRatio: 1, isBloomOn: false, multisampling: 0, flashlightShadow: 512, castsEyeShadow: false },
});

/**
 * Renderer with an optional bloom pass and a quality switch (resolution, bloom, shadow detail).
 * Tone mapping runs at the end of the effect chain (pmndrs/postprocessing), so the renderer itself does none;
 * `renderer.toneMappingExposure` still sets the brightness.
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.PerspectiveCamera} camera
 * @param {{ flashlight: THREE.SpotLight, eye: THREE.SpotLight }} shadowLights
 */
export function createGraphics(renderer, scene, camera, shadowLights) {
  renderer.toneMapping = THREE.NoToneMapping;
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: MSAA_SAMPLES });
  const bloom = new BloomEffect(BLOOM);
  const toneMapping = () => new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  // The composer draws to the screen with its last pass, so the two variants are swapped rather than disabled.
  const effectPasses = {
    withBloom: new EffectPass(camera, bloom, toneMapping()),
    plain: new EffectPass(camera, toneMapping()),
  };
  let effectPass = effectPasses.withBloom;
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(effectPass);

  let quality = QUALITY.high;

  const resize = () => {
    const pixelRatio = Math.min(window.devicePixelRatio, quality.maxPixelRatio);
    renderer.setPixelRatio(pixelRatio);
    composer.setSize(window.innerWidth, window.innerHeight); // also resizes the renderer
  };

  return {
    bloom,
    resize,

    /** Applied from the pause menu, so the shader recompile it may cause goes unnoticed. @param {boolean} isHigh */
    setQuality(isHigh) {
      quality = isHigh ? QUALITY.high : QUALITY.low;
      composer.removePass(effectPass);
      effectPass = quality.isBloomOn ? effectPasses.withBloom : effectPasses.plain;
      composer.addPass(effectPass);
      composer.multisampling = quality.multisampling;
      setShadowSize(shadowLights.flashlight, quality.flashlightShadow);
      shadowLights.eye.castShadow = quality.castsEyeShadow;
      resize();
    },

    /** @param {number} dt */
    render(dt) {
      composer.render(dt);
    },

    /** Builds every shader up front so the first lamp, flashlight or monster sighting does not stutter. */
    precompile: () => renderer.compileAsync(scene, camera),
  };
}

function setShadowSize(light, size) {
  if (light.shadow.mapSize.x === size) return;
  light.shadow.mapSize.set(size, size);
  light.shadow.map?.dispose();
  light.shadow.map = null; // rebuilt at the new size on the next frame
}
