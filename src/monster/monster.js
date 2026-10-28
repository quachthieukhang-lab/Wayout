import * as THREE from 'three';
import { cellToWorld, worldToCell, isVent, isWalkable, isMonsterWalkable } from '../level/level.js';
import { findPath, hasLineOfSight } from '../level/pathfinding.js';

export const MonsterState = Object.freeze({
  PATROL: 'patrol',
  CHASE: 'chase',
  SEARCH: 'search',
  STUNNED: 'stunned',
});

const PATROL_SPEED = 1.4;
const SEARCH_SPEED = 2.0;
const CHASE_SPEED = 3.7;
const RAGE_SPEED_BONUS = 0.15; // per key the player has found

const SIGHT_RANGE = 8;
const LIT_SIGHT_RANGE = 13; // a lit flashlight gives the player away

// Awareness: it has to keep seeing/hearing you for a moment before it is sure.
const SIGHT_NOTICE_TIME = 0.9; // seconds of being seen before it charges
const HEARING_NOTICE_TIME = 0.5;
const CLOSE_RANGE = 4; // inside this it notices twice as fast
const AWARENESS_DECAY = 0.4; // per second while it neither sees nor hears you
const SUSPICIOUS = 0.35; // awareness at which it walks over to check
const REACTION_TIME = 0.8; // freezes and roars before charging
const CROUCH_SIGHT_FACTOR = 0.6;
const VIEW_CONE_COS = Math.cos(THREE.MathUtils.degToRad(70));

const WALL_MUFFLE = 0.35; // fraction of the player's noise radius that carries through walls
const CATCH_DISTANCE = 1.2;
const DIRECT_CHASE_DISTANCE = 5;
const REPATH_INTERVAL = 0.35;
const SEARCH_DURATION = 8;
const SEARCH_RADIUS = 3; // cells around the last known position
const HUNT_CHANCE = 0.12; // how often a patrol drifts toward the player's area
const HUNT_RADIUS = 6; // cells
const TURN_RATE = 7;
const ARRIVE_EPSILON = 0.05;
const ANIMATION_BASE_RATE = 0.6; // clip speed when standing; grows with movement speed
const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

// Its gaze: a dim red light from its eyes shows where it is looking.
const EYE_HEIGHT = 1.45;
const EYE_FORWARD = 0.3;
const EYE_ANGLE = 0.55;
const EYE_SHADOW_NEAR = 0.4; // so its own head does not block the light
const EYE_LOOK = Object.freeze({
  [MonsterState.PATROL]: { color: 0xff7040, intensity: 4 },
  [MonsterState.SEARCH]: { color: 0xff4a18, intensity: 7 },
  [MonsterState.CHASE]: { color: 0xff1608, intensity: 12 },
  [MonsterState.STUNNED]: { color: 0xff1608, intensity: 0 },
});

/**
 * @typedef {{ position: THREE.Vector3, noiseRadius: number, isCrouching: boolean, isLit: boolean, isHidden?: boolean }} MonsterTarget
 * @typedef {'spotted' | 'caught' | null} MonsterEvent
 */

/** Grid-pathing stalker: patrols, sees/hears the player, chases, then searches where it lost them. */
export class Monster {
  /**
   * @param {import('../level/level.js').Level} level
   * @param {() => number} [rng]
   */
  constructor(level, rng = Math.random) {
    this.level = level;
    this.rng = rng;

    const start = cellToWorld(level.monsterSpawn);
    this.object = new THREE.Group();
    this.object.position.set(start.x, 0, start.z);
    this.body = new THREE.Group(); // animated pivot that holds the model
    this.object.add(this.body);
    this.eyeLight = createEyeLight();
    this.object.add(this.eyeLight, this.eyeLight.target);

    /** @type {typeof MonsterState[keyof typeof MonsterState]} */
    this.state = MonsterState.PATROL;
    this.isPerceiving = false; // mid-chase and it currently sees or hears the player
    this.sawHiding = false; // it watched the player climb into a hiding spot
    this.wasTargetHidden = false;
    this.path = [];
    this.repathTimer = 0;
    this.searchTimer = 0;
    this.stunTimer = 0;
    this.reactTimer = 0;
    this.awareness = 0; // 0..1, reaching 1 starts a chase
    this.lastKnown = new THREE.Vector3();
    this.rage = 0;
    this.speedScale = 1; // difficulty
    this.hearingScale = 1;
    this.yaw = 0;
    this.speed = 0;

    this.mixer = null; // set when the model ships its own animation
    this._previous = new THREE.Vector3();
  }

  get position() {
    return this.object.position;
  }

  /** @param {THREE.Object3D} model */
  setModel(model) {
    this.body.clear();
    this.body.add(model);
    this.mixer = model.userData.mixer ?? null;
  }

  /** @param {number} rage how many keys the player has found */
  setRage(rage) {
    this.rage = rage;
  }

  /** @param {import('../core/difficulty.js').Difficulty} difficulty */
  setDifficulty(difficulty) {
    this.speedScale = difficulty.monsterSpeed;
    this.hearingScale = difficulty.hearing;
  }

  /**
   * A noise somewhere else, e.g. a thrown bottle smashing. If it carries this far it goes to look; mid-chase it
   * takes the bait only once it has lost sight of the player.
   * @param {{ x: number, z: number }} position
   * @param {number} radius how far the noise carries in the open (m)
   * @returns {boolean} whether it heard and went for it
   */
  hearNoise(position, radius) {
    if (this.state === MonsterState.STUNNED || (this.state === MonsterState.CHASE && this.isPerceiving)) return false;
    const muffle = hasLineOfSight(this.level, this.position, position) ? 1 : WALL_MUFFLE;
    if (this.distanceTo(position) > radius * muffle) return false; // difficulty scales the player's noise, not lures

    const point = new THREE.Vector3(position.x, 0, position.z);
    if (this.state === MonsterState.CHASE) {
      this.lastKnown.copy(point);
      this.repathTimer = 0;
    } else {
      this.investigate(point);
    }
    return true;
  }

  /** Makes the monster rush to a position, e.g. after a loud noise. @param {THREE.Vector3} position */
  alert(position) {
    this.state = MonsterState.CHASE;
    this.isPerceiving = true; // until its next update says otherwise, so a stray noise cannot pull it away this frame
    this.lastKnown.copy(position);
    this.path = [];
    this.repathTimer = 0;
  }

  /** Walks over to check a noise without committing to a chase. @param {THREE.Vector3} position */
  investigate(position) {
    if (this.state === MonsterState.CHASE || this.state === MonsterState.STUNNED) return;
    this.state = MonsterState.SEARCH;
    this.searchTimer = SEARCH_DURATION;
    this.lastKnown.copy(position);
    this.path = this.pathTo(worldToCell(position.x, position.z));
  }

  /** Staggers the monster: it cannot move, see, hear or catch until the timer runs out. @param {number} seconds */
  stun(seconds) {
    this.state = MonsterState.STUNNED;
    this.stunTimer = seconds;
    this.path = [];
  }

  /** Horizontal distance. @param {{ x: number, z: number }} point */
  distanceTo(point) {
    return Math.hypot(point.x - this.position.x, point.z - this.position.z);
  }

  /**
   * @param {number} dt
   * @param {MonsterTarget} target
   * @returns {MonsterEvent}
   */
  update(dt, target) {
    if (this.state === MonsterState.STUNNED) {
      this.updateStun(dt);
      this.updateEyes(dt);
      return null;
    }

    const distance = this.distanceTo(target.position);
    const hasClearLine = hasLineOfSight(this.level, this.position, target.position);
    const targetCell = worldToCell(target.position.x, target.position.z);
    this.isTargetInVent = isVent(this.level, targetCell.x, targetCell.z); // out of its reach
    const isExposed = this.updateHiding(Boolean(target.isHidden), distance, hasClearLine);
    if (distance < CATCH_DISTANCE && hasClearLine && !this.isTargetInVent && isExposed) return 'caught';

    const hearingRadius = (hasClearLine ? target.noiseRadius : target.noiseRadius * WALL_MUFFLE) * this.hearingScale;
    const isHeard = isExposed && distance < hearingRadius;
    const isSeen = isExposed && this.canSee(target, distance, hasClearLine);
    const event = this.updateAwareness(dt, isSeen, isHeard, distance, target.position);
    const isPerceived = this.state === MonsterState.CHASE && (isSeen || isHeard);
    this.isPerceiving = isPerceived;

    this._previous.copy(this.position);
    this.think(dt, target, distance, isPerceived);
    this.speed = dt > 0 ? this._previous.distanceTo(this.position) / dt : 0;
    this.animate(dt);
    this.updateEyes(dt);
    return event;
  }

  /**
   * A hidden player is invisible and silent to it — unless it was chasing them and watched them climb in.
   * @returns {boolean} whether it can still sense the player
   */
  updateHiding(isHidden, distance, hasClearLine) {
    if (isHidden && !this.wasTargetHidden) {
      this.sawHiding = this.state === MonsterState.CHASE && hasClearLine && distance < SIGHT_RANGE;
    }
    if (!isHidden) this.sawHiding = false;
    this.wasTargetHidden = isHidden;
    return !isHidden || this.sawHiding;
  }

  /**
   * Builds suspicion while it sees/hears the player: suspicious → goes to look, certain → charges.
   * @returns {MonsterEvent}
   */
  updateAwareness(dt, isSeen, isHeard, distance, position) {
    if (this.state === MonsterState.CHASE) {
      if (isSeen || isHeard) this.lastKnown.copy(position);
      return null;
    }

    const boost = distance < CLOSE_RANGE ? 2 : 1;
    const gain = (isSeen ? boost / SIGHT_NOTICE_TIME : 0) + (isHeard ? boost / HEARING_NOTICE_TIME : 0);
    if (gain === 0) {
      this.awareness = Math.max(this.awareness - AWARENESS_DECAY * dt, 0);
      return null;
    }

    this.awareness += gain * dt;
    if (this.awareness >= 1) {
      this.awareness = 0;
      this.alert(position);
      this.reactTimer = REACTION_TIME;
      return 'spotted';
    }
    if (this.awareness >= SUSPICIOUS && this.state === MonsterState.PATROL) this.investigate(position);
    return null;
  }

  /** Recoils back from the light and holds still, then searches where it last saw the player. */
  updateStun(dt) {
    this.speed = 0;
    this.stunTimer -= dt;
    this.mixer?.update(dt * 0.3);
    this.body.rotation.x = THREE.MathUtils.damp(this.body.rotation.x, -0.3, 8, dt);
    if (this.stunTimer > 0) return;
    this.state = MonsterState.SEARCH;
    this.searchTimer = SEARCH_DURATION;
  }

  /**
   * @param {MonsterTarget} target
   * @param {number} distance
   * @param {boolean} [hasClearLine] precomputed line of sight, if the caller already has it
   */
  canSee(target, distance, hasClearLine) {
    let range = target.isLit ? LIT_SIGHT_RANGE : SIGHT_RANGE;
    if (target.isCrouching) range *= CROUCH_SIGHT_FACTOR;
    if (distance > range) return false;

    // While hunting it notices only what is in front of it; mid-chase it tracks all around.
    if (this.state !== MonsterState.CHASE && distance > 0) {
      const facing =
        ((target.position.x - this.position.x) * Math.sin(this.yaw) +
          (target.position.z - this.position.z) * Math.cos(this.yaw)) /
        distance;
      if (facing < VIEW_CONE_COS) return false;
    }
    if (target.isCrouching) return hasLineOfSight(this.level, this.position, target.position, isWalkable); // ducked behind a bed
    return hasClearLine ?? hasLineOfSight(this.level, this.position, target.position);
  }

  think(dt, target, distance, isPerceived) {
    if (this.state === MonsterState.CHASE) this.chase(dt, target, distance, isPerceived);
    else if (this.state === MonsterState.SEARCH) this.search(dt);
    else this.patrol(dt, target);
  }

  chase(dt, target, distance, isPerceived) {
    if (this.reactTimer > 0) {
      this.reactTimer -= dt; // the roar: turns toward you but holds still
      this.faceDirection(target.position.x - this.position.x, target.position.z - this.position.z, dt);
      return;
    }
    const speed = (CHASE_SPEED + this.rage * RAGE_SPEED_BONUS) * this.speedScale;
    if (
      isPerceived &&
      !this.isTargetInVent &&
      distance < DIRECT_CHASE_DISTANCE &&
      hasLineOfSight(this.level, this.position, target.position)
    ) {
      this.path = [];
      this.moveToward(target.position, speed, dt);
      return;
    }

    this.repathTimer -= dt;
    if (this.repathTimer <= 0) {
      this.repathTimer = REPATH_INTERVAL;
      this.path = this.pathTo(worldToCell(this.lastKnown.x, this.lastKnown.z));
    }
    if (this.followPath(speed, dt) && !isPerceived) {
      this.state = MonsterState.SEARCH;
      this.searchTimer = SEARCH_DURATION;
      this.path = [];
    }
  }

  search(dt) {
    this.searchTimer -= dt;
    if (this.searchTimer <= 0) {
      this.state = MonsterState.PATROL;
      this.path = [];
      return;
    }
    if (this.followPath(SEARCH_SPEED * this.speedScale, dt)) {
      this.path = this.pathTo(this.randomCellNear(worldToCell(this.lastKnown.x, this.lastKnown.z), SEARCH_RADIUS));
    }
  }

  patrol(dt, target) {
    if (!this.followPath(PATROL_SPEED * this.speedScale, dt)) return;
    const goal =
      this.rng() < HUNT_CHANCE
        ? this.randomCellNear(worldToCell(target.position.x, target.position.z), HUNT_RADIUS)
        : this.level.monsterCells[Math.floor(this.rng() * this.level.monsterCells.length)];
    this.path = this.pathTo(goal);
  }

  /** @returns {boolean} true once the path is finished */
  followPath(speed, dt) {
    if (this.path.length === 0) return true;
    if (this.moveToward(cellToWorld(this.path[0]), speed, dt)) this.path.shift();
    return this.path.length === 0;
  }

  pathTo(goal) {
    const start = this.nearestOpenCell(worldToCell(this.position.x, this.position.z));
    return findPath(this.level, start, this.nearestOpenCell(goal), isMonsterWalkable) ?? [];
  }

  /** The cell itself, or — when it is furniture it climbed onto or a vent — the open neighbour closest to it. */
  nearestOpenCell(cell) {
    if (isMonsterWalkable(this.level, cell.x, cell.z)) return cell;
    const open = NEIGHBOURS.map(([dx, dz]) => ({ x: cell.x + dx, z: cell.z + dz })).filter((c) =>
      isMonsterWalkable(this.level, c.x, c.z),
    );
    let best = cell;
    let bestDistance = Infinity;
    for (const c of open) {
      const { x, z } = cellToWorld(c);
      const distance = Math.hypot(x - this.position.x, z - this.position.z);
      if (distance < bestDistance) [best, bestDistance] = [c, distance];
    }
    return best;
  }

  randomCellNear(center, radius) {
    const nearby = this.level.monsterCells.filter(
      (c) => Math.abs(c.x - center.x) <= radius && Math.abs(c.z - center.z) <= radius,
    );
    const cells = nearby.length > 0 ? nearby : this.level.monsterCells;
    return cells[Math.floor(this.rng() * cells.length)];
  }

  /** @returns {boolean} true when the point is reached */
  moveToward(point, speed, dt) {
    const dx = point.x - this.position.x;
    const dz = point.z - this.position.z;
    const distance = Math.hypot(dx, dz);
    this.faceDirection(dx, dz, dt);

    const step = speed * dt;
    if (distance <= step + ARRIVE_EPSILON) {
      this.position.x = point.x;
      this.position.z = point.z;
      return true;
    }
    this.position.x += (dx / distance) * step;
    this.position.z += (dz / distance) * step;
    return false;
  }

  faceDirection(dx, dz, dt) {
    if (dx === 0 && dz === 0) return;
    const delta = THREE.MathUtils.euclideanModulo(Math.atan2(dx, dz) - this.yaw + Math.PI, Math.PI * 2) - Math.PI;
    this.yaw += delta * (1 - Math.exp(-TURN_RATE * dt));
    this.object.rotation.y = this.yaw;
  }

  /** Plays the model's own clip faster as it moves, and leans it forward a little while it charges. No wobble. */
  animate(dt) {
    const motion = Math.min(this.speed / CHASE_SPEED, 1.2);
    this.mixer?.update(dt * (ANIMATION_BASE_RATE + motion));
    const lean = this.state === MonsterState.CHASE ? 0.15 : 0;
    this.body.rotation.x = THREE.MathUtils.damp(this.body.rotation.x, lean * Math.min(motion * 1.5, 1), 4, dt);
  }

  /** Eye glow follows its mood: dim while wandering, angry red while chasing, out while stunned. */
  updateEyes(dt) {
    const look = EYE_LOOK[this.state];
    this.eyeLight.color.lerp(_eyeColor.set(look.color), 1 - Math.exp(-6 * dt));
    this.eyeLight.intensity = THREE.MathUtils.damp(this.eyeLight.intensity, look.intensity, 6, dt);
  }
}

const _eyeColor = new THREE.Color();

function createEyeLight() {
  const { color, intensity } = EYE_LOOK[MonsterState.PATROL];
  const light = new THREE.SpotLight(color, intensity, SIGHT_RANGE + 2, EYE_ANGLE, 0.7, 1.2);
  light.position.set(0, EYE_HEIGHT, EYE_FORWARD);
  light.target.position.set(0, 0.3, SIGHT_RANGE); // the model faces +Z
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  light.shadow.camera.near = EYE_SHADOW_NEAR;
  light.shadow.bias = -0.0005;
  light.shadow.normalBias = 0.02;
  return light;
}
