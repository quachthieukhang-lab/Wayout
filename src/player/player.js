import * as THREE from 'three';

const STAND_HEIGHT = 1.8;
const CROUCH_HEIGHT = 1.0;
const EYE_OFFSET = 0.12;
const RADIUS = 0.35;
const STEP_HEIGHT = 0.35;

const WALK_SPEED = 3.0;
const SPRINT_SPEED = 5.6;
const CROUCH_SPEED = 1.6;
const QUIET_SPEED = 1.8; // hold Z: slow, careful steps

const MAX_STAMINA = 6; // seconds of sprinting
const STAMINA_REGEN = 1; // per second
const STAMINA_RECOVER = 1.5; // must refill to this after running out
const GROUND_ACCEL = 14;
const AIR_ACCEL = 3;

const JUMP_VELOCITY = 7.2;
const GRAVITY = 22;
const MAX_FALL_SPEED = 40;
const COYOTE_TIME = 0.1;
const JUMP_BUFFER = 0.12;

const MOUSE_SENSITIVITY = 0.0022;
const MAX_PITCH = Math.PI / 2 - 0.01;
const BASE_FOV = 75;
const SPRINT_FOV_BOOST = 8;

const MAX_SUBSTEP = 0.2;
const MOVING_THRESHOLD = 0.5;
const KILL_Y = -30;
const EPSILON = 0.001;

const DEFAULT_SPAWN = new THREE.Vector3(0, 0, 8);

export const PlayerState = Object.freeze({
  IDLE: 'Idle',
  WALK: 'Walking',
  QUIET_WALK: 'Walking quietly',
  SPRINT: 'Sprinting',
  CROUCH: 'Crouching',
  CROUCH_WALK: 'Sneaking',
  JUMP: 'Jumping',
  FALL: 'Falling',
});

/** How far away (m) the monster can hear the player in each state. */
const NOISE_RADIUS = Object.freeze({
  [PlayerState.IDLE]: 0,
  [PlayerState.WALK]: 5,
  [PlayerState.QUIET_WALK]: 2,
  [PlayerState.SPRINT]: 12,
  [PlayerState.CROUCH]: 0,
  [PlayerState.CROUCH_WALK]: 1.5,
  [PlayerState.JUMP]: 7,
  [PlayerState.FALL]: 7,
});

export const PLAYER_CONFIG = Object.freeze({
  STAND_HEIGHT,
  CROUCH_HEIGHT,
  RADIUS,
  STEP_HEIGHT,
  WALK_SPEED,
  SPRINT_SPEED,
  MAX_STAMINA,
});

/**
 * First-person character: AABB collision against static boxes, walk / sprint /
 * jump / crouch, step-up for stairs, and camera effects (head bob, landing dip, FOV).
 */
export class Player {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.Box3[]} colliders
   * @param {{ isDown: (...codes: string[]) => boolean, wasPressed: (...codes: string[]) => boolean }} input
   * @param {THREE.Vector3} [spawn]
   */
  constructor(camera, colliders, input, spawn = DEFAULT_SPAWN) {
    this.camera = camera;
    this.colliders = colliders;
    this.input = input;
    this.spawn = spawn.clone();

    this.position = spawn.clone(); // feet position
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;

    this.height = STAND_HEIGHT;
    this.eyeHeight = STAND_HEIGHT - EYE_OFFSET;
    this.isGrounded = false;
    this.isCrouching = false;
    this.isSprinting = false;
    this.isWalkingQuietly = false;
    this.stamina = MAX_STAMINA;
    this.isExhausted = false;
    this.enabled = false;
    /** @type {typeof PlayerState[keyof typeof PlayerState]} */
    this.state = PlayerState.IDLE;

    // Player settings
    this.mouseSensitivity = 1;
    this.isYInverted = false;
    this.baseFov = BASE_FOV;

    this.timeSinceGrounded = Infinity;
    this.jumpBufferTimer = 0;

    this.bobPhase = 0;
    this.bobWeight = 0;
    this.landDip = 0;
    this.stepOffset = 0;

    this._wish = new THREE.Vector3();
    this._probe = new THREE.Vector3();
  }

  /** @param {number} dx @param {number} dy mouse movement in pixels */
  look(dx, dy) {
    const sensitivity = MOUSE_SENSITIVITY * this.mouseSensitivity;
    const pitchDelta = dy * sensitivity * (this.isYInverted ? -1 : 1);
    this.yaw -= dx * sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch - pitchDelta, -MAX_PITCH, MAX_PITCH);
  }

  /** @param {number} dt seconds */
  update(dt) {
    const moveInput = this.readMoveInput();
    this.updateCrouch();
    const wantsSprint =
      this.enabled && this.input.isDown('ShiftLeft', 'ShiftRight') && moveInput.forward > 0 && !this.isCrouching;
    this.isSprinting = wantsSprint && !this.isExhausted;
    this.isWalkingQuietly = this.enabled && this.input.isDown('KeyZ') && !this.isCrouching && !this.isSprinting;
    this.updateStamina(dt);
    this.updateHorizontalVelocity(moveInput, dt);
    this.updateJump(dt);
    this.velocity.y = Math.max(this.velocity.y - GRAVITY * dt, -MAX_FALL_SPEED);
    this.moveAndCollide(dt);

    if (this.position.y < KILL_Y) this.respawn();

    this.updateState();
    this.updateCamera(dt);
  }

  respawn() {
    this.position.copy(this.spawn);
    this.velocity.set(0, 0, 0);
  }

  get horizontalSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** Radius (m) within which the monster hears the player. */
  get noiseRadius() {
    return NOISE_RADIUS[this.state];
  }

  updateStamina(dt) {
    if (this.isSprinting) {
      this.stamina = Math.max(this.stamina - dt, 0);
      if (this.stamina === 0) this.isExhausted = true;
    } else {
      this.stamina = Math.min(this.stamina + STAMINA_REGEN * dt, MAX_STAMINA);
      if (this.stamina >= STAMINA_RECOVER) this.isExhausted = false;
    }
  }

  readMoveInput() {
    if (!this.enabled) return { forward: 0, right: 0 };
    const axis = (pos, neg) => (this.input.isDown(...pos) ? 1 : 0) - (this.input.isDown(...neg) ? 1 : 0);
    return {
      forward: axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']),
      right: axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']),
    };
  }

  updateCrouch() {
    const wantsCrouch = this.enabled && this.input.isDown('KeyC');
    if (wantsCrouch) {
      this.isCrouching = true;
      this.height = CROUCH_HEIGHT;
    } else if (this.isCrouching && this.canFit(this.position, STAND_HEIGHT)) {
      this.isCrouching = false;
      this.height = STAND_HEIGHT;
    }
  }

  updateHorizontalVelocity({ forward, right }, dt) {
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // forward = (-sin, 0, -cos), right = (cos, 0, -sin)
    this._wish.set(-sin * forward + cos * right, 0, -cos * forward - sin * right);
    if (this._wish.lengthSq() > 1) this._wish.normalize();

    const speed = this.isCrouching
      ? CROUCH_SPEED
      : this.isSprinting
        ? SPRINT_SPEED
        : this.isWalkingQuietly
          ? QUIET_SPEED
          : WALK_SPEED;
    const t = 1 - Math.exp(-(this.isGrounded ? GROUND_ACCEL : AIR_ACCEL) * dt);
    this.velocity.x += (this._wish.x * speed - this.velocity.x) * t;
    this.velocity.z += (this._wish.z * speed - this.velocity.z) * t;
  }

  updateJump(dt) {
    this.timeSinceGrounded = this.isGrounded ? 0 : this.timeSinceGrounded + dt;
    this.jumpBufferTimer = this.enabled && this.input.wasPressed('Space') ? JUMP_BUFFER : this.jumpBufferTimer - dt;

    const canJump = this.timeSinceGrounded <= COYOTE_TIME && !this.isCrouching;
    if (this.jumpBufferTimer > 0 && canJump) {
      this.velocity.y = JUMP_VELOCITY;
      this.jumpBufferTimer = 0;
      this.timeSinceGrounded = Infinity;
      this.isGrounded = false;
    }
  }

  moveAndCollide(dt) {
    const wasGrounded = this.isGrounded;
    const fallSpeed = -this.velocity.y;
    const maxDelta = Math.max(Math.abs(this.velocity.x), Math.abs(this.velocity.y), Math.abs(this.velocity.z)) * dt;
    const steps = Math.max(1, Math.ceil(maxDelta / MAX_SUBSTEP));
    const stepDt = dt / steps;

    this.isGrounded = false;
    for (let i = 0; i < steps; i++) {
      const canStep = wasGrounded || this.isGrounded;
      this.moveAxis('x', this.velocity.x * stepDt, canStep);
      this.moveAxis('z', this.velocity.z * stepDt, canStep);
      this.moveAxis('y', this.velocity.y * stepDt, false);
    }

    if (!wasGrounded && this.isGrounded && fallSpeed > 4) {
      this.landDip = Math.min((fallSpeed - 4) * 0.03, 0.3);
    }
  }

  moveAxis(axis, delta, canStep) {
    if (delta === 0) return;
    this.position[axis] += delta;

    for (const box of this.colliders) {
      if (!this.overlaps(box, this.position, this.height)) continue;

      if (axis === 'y') {
        this.resolveVertical(box, delta);
      } else if (!(canStep && this.tryStepUp(box))) {
        this.position[axis] = delta > 0 ? box.min[axis] - RADIUS - EPSILON : box.max[axis] + RADIUS + EPSILON;
        this.velocity[axis] = 0;
      }
    }
  }

  resolveVertical(box, delta) {
    if (delta < 0) {
      this.position.y = box.max.y;
      this.isGrounded = true;
    } else {
      this.position.y = box.min.y - this.height - EPSILON;
    }
    this.velocity.y = 0;
  }

  tryStepUp(box) {
    const rise = box.max.y - this.position.y;
    if (rise <= 0 || rise > STEP_HEIGHT) return false;

    this._probe.copy(this.position).setY(box.max.y + EPSILON);
    if (!this.canFit(this._probe, this.height)) return false;

    this.position.copy(this._probe);
    this.stepOffset -= rise; // camera eases up instead of snapping
    return true;
  }

  overlaps(box, pos, height) {
    return (
      pos.x - RADIUS < box.max.x &&
      pos.x + RADIUS > box.min.x &&
      pos.y < box.max.y &&
      pos.y + height > box.min.y &&
      pos.z - RADIUS < box.max.z &&
      pos.z + RADIUS > box.min.z
    );
  }

  canFit(pos, height) {
    return !this.colliders.some((box) => this.overlaps(box, pos, height));
  }

  updateState() {
    const isMoving = this.horizontalSpeed > MOVING_THRESHOLD;
    if (!this.isGrounded) {
      this.state = this.velocity.y > 0 ? PlayerState.JUMP : PlayerState.FALL;
    } else if (this.isCrouching) {
      this.state = isMoving ? PlayerState.CROUCH_WALK : PlayerState.CROUCH;
    } else if (isMoving) {
      this.state = this.isSprinting
        ? PlayerState.SPRINT
        : this.isWalkingQuietly
          ? PlayerState.QUIET_WALK
          : PlayerState.WALK;
    } else {
      this.state = PlayerState.IDLE;
    }
  }

  updateCamera(dt) {
    const { damp } = THREE.MathUtils;
    const speed = this.horizontalSpeed;

    this.eyeHeight = damp(this.eyeHeight, this.height - EYE_OFFSET, 12, dt);
    this.stepOffset = damp(this.stepOffset, 0, 14, dt);
    this.landDip = damp(this.landDip, 0, 8, dt);

    const isBobbing = this.isGrounded && speed > MOVING_THRESHOLD;
    if (isBobbing) this.bobPhase += dt * speed * 1.4;
    this.bobWeight = damp(this.bobWeight, isBobbing ? Math.min(speed / SPRINT_SPEED, 1) : 0, 10, dt);

    const bobY = Math.sin(this.bobPhase * 2) * 0.045 * this.bobWeight;
    const bobX = Math.cos(this.bobPhase) * 0.03 * this.bobWeight;

    this.camera.position.set(
      this.position.x + Math.cos(this.yaw) * bobX,
      this.position.y + this.eyeHeight + this.stepOffset - this.landDip + bobY,
      this.position.z - Math.sin(this.yaw) * bobX,
    );
    this.camera.rotation.set(this.pitch, this.yaw, -bobX * 0.15, 'YXZ');

    const targetFov = this.isSprinting && speed > WALK_SPEED ? this.baseFov + SPRINT_FOV_BOOST : this.baseFov;
    const fov = damp(this.camera.fov, targetFov, 8, dt);
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
