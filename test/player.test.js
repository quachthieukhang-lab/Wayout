import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Player, PlayerState, PLAYER_CONFIG } from '../src/player/player.js';

const DT = 1 / 60;

class FakeInput {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
  }
  isDown(...codes) {
    return codes.some((c) => this.keys.has(c));
  }
  wasPressed(...codes) {
    return codes.some((c) => this.pressed.has(c));
  }
  press(code) {
    this.pressed.add(code);
  }
}

const ground = () => new THREE.Box3(new THREE.Vector3(-50, -1, -50), new THREE.Vector3(50, 0, 50));
const box = (min, max) => new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));

function setup(colliders = [ground()], spawn = new THREE.Vector3(0, 0, 0)) {
  const input = new FakeInput();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 100);
  const player = new Player(camera, colliders, input, spawn);
  player.enabled = true;
  const step = (frames = 1) => {
    for (let i = 0; i < frames; i++) {
      player.update(DT);
      input.pressed.clear();
    }
  };
  return { player, input, step };
}

describe('Player', () => {
  it('falls from the air and lands on the ground', () => {
    const { player, step } = setup([ground()], new THREE.Vector3(0, 5, 0));
    step(120);
    expect(player.position.y).toBeCloseTo(0, 5);
    expect(player.isGrounded).toBe(true);
    expect(player.state).toBe(PlayerState.IDLE);
  });

  it('jumps above 1m and lands again', () => {
    const { player, input, step } = setup();
    step(5);
    input.press('Space');
    let peak = 0;
    for (let i = 0; i < 90; i++) {
      step();
      peak = Math.max(peak, player.position.y);
    }
    expect(peak).toBeGreaterThan(1);
    expect(player.isGrounded).toBe(true);
    expect(player.position.y).toBeCloseTo(0, 5);
  });

  it('walks forward (-Z) at walk speed and sprints faster with Shift', () => {
    const { player, input, step } = setup();
    input.keys.add('KeyW');
    step(60);
    expect(player.velocity.z).toBeLessThan(0);
    expect(player.horizontalSpeed).toBeCloseTo(PLAYER_CONFIG.WALK_SPEED, 1);
    expect(player.state).toBe(PlayerState.WALK);

    input.keys.add('ShiftLeft');
    step(60);
    expect(player.horizontalSpeed).toBeCloseTo(PLAYER_CONFIG.SPRINT_SPEED, 1);
    expect(player.state).toBe(PlayerState.SPRINT);
  });

  it('is blocked by a wall', () => {
    const wall = box([-5, 0, -3], [5, 3, -2]);
    const { player, input, step } = setup([ground(), wall]);
    input.keys.add('KeyW');
    step(180);
    expect(player.position.z).toBeGreaterThan(-2 + PLAYER_CONFIG.RADIUS - 0.01);
  });

  it('steps up a small stair but not a tall box', () => {
    const stair = box([-2, 0, -10], [2, 0.3, -2]);
    const { player, input, step } = setup([ground(), stair]);
    input.keys.add('KeyW');
    step(60);
    expect(player.position.y).toBeCloseTo(0.3, 2);

    const tall = box([-2, 0, -3], [2, 0.8, -2]);
    const blocked = setup([ground(), tall]);
    blocked.input.keys.add('KeyW');
    blocked.step(60);
    expect(blocked.player.position.y).toBeCloseTo(0, 5);
  });

  it('crouches, cannot jump while crouched, and stays crouched under a low ceiling', () => {
    const ceiling = box([-2, 1.25, -2], [2, 2, 2]);
    const { player, input, step } = setup([ground(), ceiling]);
    input.keys.add('KeyC');
    step(10);
    expect(player.isCrouching).toBe(true);
    expect(player.height).toBe(PLAYER_CONFIG.CROUCH_HEIGHT);
    expect(player.state).toBe(PlayerState.CROUCH);

    input.press('Space');
    step(10);
    expect(player.position.y).toBeCloseTo(0, 5);

    input.keys.delete('KeyC');
    step(10);
    expect(player.isCrouching).toBe(true);
  });

  it('stands up when C is released in open space', () => {
    const { player, input, step } = setup();
    input.keys.add('KeyC');
    step(5);
    input.keys.delete('KeyC');
    step(5);
    expect(player.isCrouching).toBe(false);
    expect(player.height).toBe(PLAYER_CONFIG.STAND_HEIGHT);
  });

  it('runs out of stamina, drops to walk speed, then recovers', () => {
    const { player, input, step } = setup();
    input.keys.add('KeyW');
    input.keys.add('ShiftLeft');
    step(Math.ceil(PLAYER_CONFIG.MAX_STAMINA * 60) + 60);
    expect(player.isExhausted).toBe(true);
    expect(player.horizontalSpeed).toBeCloseTo(PLAYER_CONFIG.WALK_SPEED, 1);

    input.keys.delete('ShiftLeft');
    step(60 * 4);
    expect(player.isExhausted).toBe(false);
  });

  it('makes more noise sprinting than walking, and almost none crouching', () => {
    const { player, input, step } = setup();
    input.keys.add('KeyW');
    step(30);
    const walkNoise = player.noiseRadius;
    input.keys.add('ShiftLeft');
    step(30);
    expect(player.noiseRadius).toBeGreaterThan(walkNoise);
    input.keys.delete('ShiftLeft');
    input.keys.add('KeyC');
    step(30);
    expect(player.noiseRadius).toBeLessThan(walkNoise);
  });

  it('walks slower and quieter while holding Z', () => {
    const { player, input, step } = setup();
    input.keys.add('KeyW');
    step(30);
    const walk = { speed: player.horizontalSpeed, noise: player.noiseRadius };
    input.keys.add('KeyZ');
    step(30);
    expect(player.state).toBe(PlayerState.QUIET_WALK);
    expect(player.horizontalSpeed).toBeLessThan(walk.speed);
    expect(player.noiseRadius).toBeLessThan(walk.noise);
    expect(player.noiseRadius).toBeGreaterThan(0);
  });

  it('ignores input while disabled (paused)', () => {
    const { player, input, step } = setup();
    player.enabled = false;
    input.keys.add('KeyW');
    step(30);
    expect(player.horizontalSpeed).toBe(0);
  });

  it('respawns after falling out of the world', () => {
    const { player, step } = setup([], new THREE.Vector3(0, 0, 0));
    let hasRespawned = false;
    for (let i = 0; i < 200 && !hasRespawned; i++) {
      const prevY = player.position.y;
      step();
      hasRespawned = prevY < -20 && player.position.y === 0;
    }
    expect(hasRespawned).toBe(true);
  });
});
