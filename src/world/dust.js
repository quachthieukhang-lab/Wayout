import * as THREE from 'three';

const COUNT = 420;
const HALF_SIZE = 4; // particles live in an 8 m box that follows the player
const MIN_Y = 0.2;
const MAX_Y = 3.2;
const DRIFT = 0.06; // m/s
const SIZE = 22; // point size at 1 m, in pixels
const BEAM_RANGE = 7;
const BEAM_OPACITY = 0.55;

const vertexShader = /* glsl */ `
  uniform float uSize;
  uniform float uPixelRatio;
  varying vec3 vWorld;
  void main() {
    vWorld = position;
    vec4 mvPosition = viewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * uPixelRatio / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// Only specks inside the flashlight cone show up, fading with distance and toward the cone's edge.
const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uLightPosition;
  uniform vec3 uLightDirection;
  uniform float uCosOuter;
  uniform float uCosInner;
  uniform float uRange;
  uniform float uOpacity;
  varying vec3 vWorld;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float roundness = smoothstep(0.5, 0.15, length(c));
    vec3 toSpeck = vWorld - uLightPosition;
    float dist = length(toSpeck);
    float inCone = smoothstep(uCosOuter, uCosInner, dot(toSpeck / dist, uLightDirection));
    float falloff = 1.0 - smoothstep(0.0, uRange, dist);
    gl_FragColor = vec4(uColor, roundness * inCone * falloff * uOpacity);
  }
`;

/**
 * Dust floating in the air, only visible where the flashlight beam catches it.
 * @param {THREE.Scene} scene
 * @param {THREE.SpotLight} beam the flashlight
 */
export function createDust(scene, beam) {
  const positions = new Float32Array(COUNT * 3);
  const velocities = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    positions.set(
      [
        (Math.random() - 0.5) * HALF_SIZE * 2,
        MIN_Y + Math.random() * (MAX_Y - MIN_Y),
        (Math.random() - 0.5) * HALF_SIZE * 2,
      ],
      i * 3,
    );
    velocities.set(
      [(Math.random() - 0.5) * DRIFT, (Math.random() - 0.6) * DRIFT, (Math.random() - 0.5) * DRIFT],
      i * 3,
    );
  }
  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);

  const uniforms = {
    uSize: { value: SIZE },
    uPixelRatio: { value: 1 },
    uColor: { value: new THREE.Color(0xe8dcc0) },
    uLightPosition: { value: new THREE.Vector3() },
    uLightDirection: { value: new THREE.Vector3(0, 0, -1) },
    uCosOuter: { value: Math.cos(beam.angle) },
    uCosInner: { value: Math.cos(beam.angle * (1 - beam.penumbra)) },
    uRange: { value: BEAM_RANGE },
    uOpacity: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; // positions are rewritten every frame
  scene.add(points);

  const target = new THREE.Vector3();
  return {
    /**
     * @param {number} dt
     * @param {THREE.Vector3} center the player's position
     * @param {number} brightness flashlight brightness, 0 = off
     * @param {number} pixelRatio renderer pixel ratio, so specks keep their size
     */
    update(dt, center, brightness, pixelRatio) {
      uniforms.uOpacity.value = Math.min(brightness, 1) * BEAM_OPACITY;
      uniforms.uPixelRatio.value = pixelRatio;
      if (brightness <= 0) return;

      beam.getWorldPosition(uniforms.uLightPosition.value);
      beam.target.getWorldPosition(target);
      uniforms.uLightDirection.value.subVectors(target, uniforms.uLightPosition.value).normalize();

      for (let i = 0; i < COUNT * 3; i += 3) {
        positions[i] = wrap(positions[i] + velocities[i] * dt, center.x);
        positions[i + 1] =
          THREE.MathUtils.euclideanModulo(positions[i + 1] + velocities[i + 1] * dt - MIN_Y, MAX_Y - MIN_Y) + MIN_Y;
        positions[i + 2] = wrap(positions[i + 2] + velocities[i + 2] * dt, center.z);
      }
      positionAttribute.needsUpdate = true;
    },
  };
}

/** Keeps a coordinate inside the box around `center`, re-entering from the other side. */
function wrap(value, center) {
  return THREE.MathUtils.euclideanModulo(value - center + HALF_SIZE, HALF_SIZE * 2) + center - HALF_SIZE;
}
