export const WorldEvent = Object.freeze({
  BLACKOUT: 'blackout', // every lamp in the building dies for a while
  SLAM: 'slam', // an open door somewhere slams shut, loud enough to draw it over
  PHANTOM: 'phantom', // a sound behind the player that nothing made
});

/** @typedef {typeof WorldEvent[keyof typeof WorldEvent]} WorldEventKind */

const FIRST_EVENT = Object.freeze({ min: 60, max: 100 }); // s into a run
const BETWEEN_EVENTS = Object.freeze({ min: 45, max: 90 });
const KEY_HASTE = 0.1; // each key found makes the hospital restless faster
const BUSY_DELAY = 10; // s it waits when the moment is wrong (mid-chase, grabbed, hiding)
export const BLACKOUT_TIME = 18; // s without lamps
export const SLAM_DISTANCE = Object.freeze({ min: 6, max: 24 }); // m from the player
export const SLAM_NOISE = 16; // m the bang carries
const SLAM_SWING_SPEED = 14; // rad/s: it bangs shut
const PHANTOM_DISTANCE = 4; // m behind the player
const EVENT_TOASTS = Object.freeze({
  [WorldEvent.BLACKOUT]: 'The power is out...',
  [WorldEvent.SLAM]: 'Somewhere, a door slammed shut.',
});

/**
 * Decides when something happens and what: a random wait, never the same event twice in a row, never in the middle
 * of a chase.
 */
export class EventClock {
  /** @param {() => number} [rng] */
  constructor(rng = Math.random) {
    this.rng = rng;
    this.timer = this.between(FIRST_EVENT);
    /** @type {WorldEventKind | null} */
    this.last = null;
  }

  /** @param {{ min: number, max: number }} range */
  between({ min, max }) {
    return min + this.rng() * (max - min);
  }

  /**
   * @param {number} dt
   * @param {{ isBusy: boolean, keysFound: number }} context `isBusy`: a chase or a grab, no time for events
   * @returns {WorldEventKind | null} what happens now
   */
  update(dt, { isBusy, keysFound }) {
    this.timer -= dt * (1 + keysFound * KEY_HASTE);
    if (this.timer > 0) return null;
    if (isBusy) {
      this.timer = BUSY_DELAY;
      return null;
    }
    const kinds = Object.values(WorldEvent).filter((kind) => kind !== this.last);
    const kind = kinds[Math.floor(this.rng() * kinds.length)];
    this.last = kind;
    this.timer = this.between(BETWEEN_EVENTS);
    return kind;
  }
}

/**
 * Runs the events the clock picks on the real hospital: lamps, doors, the monster's ears and the sound.
 * @typedef {{
 *   world: { setPower: (isOn: boolean) => void, doors: ReturnType<typeof import('../world/doors.js').createDoors> },
 *   monster: import('../monster/monster.js').Monster,
 *   player: { position: import('three').Vector3, yaw: number },
 *   audio: { powerDown: () => void, powerUp: () => void, doorSlam: (p: { x: number, z: number }) => void,
 *     phantom: (p: { x: number, z: number }) => void },
 *   hud: { toast: (text: string) => void },
 * }} EventTargets
 */
export class WorldEvents {
  /** @param {EventTargets} targets @param {() => number} [rng] */
  constructor(targets, rng = Math.random) {
    this.targets = targets;
    this.rng = rng;
    this.clock = new EventClock(rng);
    this.blackoutTimer = 0;
  }

  get isBlackout() {
    return this.blackoutTimer > 0;
  }

  /** @param {number} dt @param {{ isBusy: boolean, keysFound: number }} context */
  update(dt, context) {
    if (this.blackoutTimer > 0) {
      this.blackoutTimer -= dt;
      if (this.blackoutTimer <= 0) this.restorePower();
    }
    const kind = this.clock.update(dt, context);
    if (kind) this.run(kind);
  }

  /** @param {WorldEventKind} kind @returns {boolean} whether it could happen */
  run(kind) {
    const happened =
      kind === WorldEvent.BLACKOUT ? this.blackout() : kind === WorldEvent.SLAM ? this.slam() : this.phantom();
    if (happened && EVENT_TOASTS[kind]) this.targets.hud.toast(EVENT_TOASTS[kind]);
    return happened;
  }

  blackout() {
    if (this.isBlackout) return false;
    this.blackoutTimer = BLACKOUT_TIME;
    this.targets.world.setPower(false);
    this.targets.audio.powerDown();
    return true;
  }

  restorePower() {
    this.blackoutTimer = 0;
    this.targets.world.setPower(true);
    this.targets.audio.powerUp();
  }

  /** An open door within earshot bangs shut; the monster comes to see, and has to force it. */
  slam() {
    const { world, player, monster, audio } = this.targets;
    const doors = world.doors;
    const distance = (door) => Math.hypot(door.position.x - player.position.x, door.position.z - player.position.z);
    const candidates = doors.doors.filter(
      (door) =>
        door.isOpen &&
        door.jamTimer === 0 &&
        distance(door) >= SLAM_DISTANCE.min &&
        distance(door) <= SLAM_DISTANCE.max &&
        !doors.isBlocked(door, player.position) &&
        !doors.isBlocked(door, monster.position),
    );
    if (candidates.length === 0) return false;
    const door = candidates[Math.floor(this.rng() * candidates.length)];
    doors.setOpen(door, false, SLAM_SWING_SPEED);
    audio.doorSlam(door.position);
    monster.hearNoise(door.position, SLAM_NOISE, true);
    return true;
  }

  /** Something right behind the player. Nothing is there; the monster hears nothing. */
  phantom() {
    const { player, audio } = this.targets;
    audio.phantom({
      x: player.position.x + Math.sin(player.yaw) * PHANTOM_DISTANCE,
      z: player.position.z + Math.cos(player.yaw) * PHANTOM_DISTANCE,
    });
    return true;
  }
}
