import * as THREE from 'three';
import { worldToCell, cellToWorld, exitApproach, noisyFloorAt, spaceAt } from '../level/level.js';
import { RADIO_NOISE } from '../world/radios.js';
import { KeySense } from '../items/key-sense.js';
import { hasLineOfSight } from '../level/pathfinding.js';
import { MonsterState, PREDICT_KEYS, WARY_KEYS } from '../monster/monster.js';
import { PickupType } from '../items/pickups.js';
import { PLAYER_CONFIG, PlayerState } from '../player/player.js';
import { Inventory } from '../items/inventory.js';
import { Bag } from './bag.js';
import { DIFFICULTIES } from './difficulty.js';
import { STORY_NOTES, TAPES, ENDINGS, endingFor } from './story.js';
import { WorldEvents } from './events.js';
import { createMonsterDirector } from './tutorial.js';
import { CloseUp, JUMPSCARE_SHOT, grabShot } from './close-up.js';
import { deathTip } from './tips.js';
import { formatTime } from './records.js';

export const GameState = Object.freeze({
  PLAYING: 'playing',
  GRABBED: 'grabbed',
  DYING: 'dying',
  DEAD: 'dead',
  WON: 'won',
});

const DANGER_RANGE = 16;
const CHASE_MIN_DANGER = 0.35;
const MONSTER_HEARING_RANGE = 24;
const MONSTER_STEP_INTERVAL = 0.6;
const MONSTER_STEP_REFERENCE_SPEED = 1.5;
const WALL_MUFFLE_VOLUME = 0.35; // its footsteps are quieter through walls
const FOOTSTEP_VOLUME = Object.freeze({ sprint: 0.35, walk: 0.2, quiet: 0.08, crouch: 0.07 });
const LOUDEST_NOISE = 12; // sprinting: a full noise meter

const HIDE_LOOK_YAW = 0.6; // how far you can turn your head inside a locker (radians)
const HIDE_LOOK_PITCH = 0.35;

const MAX_HEALTH = 100;
const HEALTH_REGEN = 2; // per second, once safe
const REGEN_DELAY = 8; // seconds without damage before regenerating

const KEY_NOISE_RANGE = 18; // how far the clink of a picked-up key carries
const TAPE_NOISE = 7; // m a playing tape carries: you listen, so might it
const TAPE_PLAY_TIME = 9; // s of murmuring
const MAP_KEY = 'KeyM';
/** Told when the monster learns something new, on the key that teaches it. */
const LEARNING_TOASTS = Object.freeze({
  [PREDICT_KEYS]: 'It is learning: when it loses you, it guesses where you were running.',
  [WARY_KEYS]: 'It is learning: it will not fall for one noise after another now.',
});
const MONSTER_DOOR_TIME = 1.4; // s it spends forcing a closed door
const DOOR_NOISE = 6; // m a door the player swings can be heard
const CAREFUL_FLOOR_VOLUME = 0.25; // glass and boards still whisper under a careful step

const GRAB_DAMAGE = 20;
const GRAB_DAMAGE_PER_SECOND = 7;
const GRAB_TIMEOUT = 5; // fail to break free in time and it kills you
const GRAB_SHOT = grabShot(GRAB_TIMEOUT);
const STRUGGLE_PER_PRESS = 0.16;
const STRUGGLE_DECAY = 0.3; // per second
const BREAK_FREE_STUN = 3.5;
const BREAK_FREE_GRACE = 2; // seconds it cannot grab you again

const FLASH_STUN = 3;
const FLASH_RANGE = 10;
const FLASH_CONE_COS = Math.cos(THREE.MathUtils.degToRad(18));
const FLASH_MIN_BATTERY = 0.2; // a burst needs this much

/**
 * @typedef {import('../level/level.js').Space} Space
 * @typedef {{
 *   level: import('../level/level.js').Level, camera: THREE.PerspectiveCamera, input: import('./input.js').Input,
 *   player: import('../player/player.js').Player, viewModel: import('../player/viewmodel.js').ViewModel,
 *   flashlight: import('../player/flashlight.js').Flashlight, monster: import('../monster/monster.js').Monster,
 *   pickups: ReturnType<typeof import('../items/pickups.js').createPickups>, world: ReturnType<typeof import('../world/world.js').createWorld>,
 *   audio: import('../audio/audio.js').HorrorAudio, hud: ReturnType<typeof import('../ui/hud.js').createHud>,
 *   rooms?: readonly import('../level/level.js').Room[],
 *   recordBook?: ReturnType<typeof import('./records.js').createRecordBook> | null,
 *   tutorial?: import('./tutorial.js').Tutorial | null
 * }} GameDeps
 */

/** Rules of the horror game: pickups, health, the monster, escaping its grip, the exit, and the jumpscare. */
export class Game {
  /** @param {GameDeps} deps */
  constructor(deps) {
    this.level = deps.level;
    this.camera = deps.camera;
    this.input = deps.input;
    this.player = deps.player;
    this.viewModel = deps.viewModel;
    this.flashlight = deps.flashlight;
    this.monster = deps.monster;
    this.pickups = deps.pickups;
    this.world = deps.world;
    this.audio = deps.audio;
    this.hud = deps.hud;
    this.rooms = deps.rooms ?? [];
    this.recordBook = deps.recordBook ?? null;
    /** @type {typeof GameState[keyof typeof GameState]} */
    this.state = GameState.PLAYING;
    this.isPaused = true;
    this.health = MAX_HEALTH;
    this.timeSinceHurt = Infinity;
    this.graceTimer = 0;
    this.keysFound = 0;
    this.totalKeys = deps.level.keys.length;
    this.pagesFound = 0;
    this.totalPages = deps.level.pages.length;
    this.hasMap = false;
    this.isMapOpen = false;
    this.runTime = 0; // s played, pauses excluded
    this.isExitOpen = false;
    this.lastStep = 0;
    this.monsterStepTimer = 0;
    this.grab = { time: 0, progress: 0, best: 0 };
    this.shotTime = 0;
    this.hidingSpot = null;
    this.wasLightOn = false;
    /** @type {import('./tips.js').DeathContext | null} how things stood when it got hold of the player */
    this.deathContext = null;
    /** @type {Space} */
    this.space = 'room';
    this.keySense = new KeySense(deps.level);
    this.hasShownSenseTip = false;
    this.bag = new Bag({
      ...deps,
      scene: deps.world.scene,
      colliders: deps.world.colliders,
      heal: (amount) => this.heal(amount),
    });
    this.floorTips = new Set(); // noisy floor kinds already explained
    /** @type {import('./difficulty.js').Difficulty} */
    this.difficulty = DIFFICULTIES.normal;
    this.tutorial = deps.tutorial ?? null;
    this.director = createMonsterDirector(deps.monster, deps.player, deps.audio);
    this.closeUp = new CloseUp(deps.camera, deps.player, deps.monster, deps.viewModel);
    // The tutorial is scripted: no random blackouts or slamming doors there.
    this.events = this.tutorial ? null : new WorldEvents(deps);
  }

  get isOver() {
    return this.state === GameState.DYING || this.state === GameState.DEAD || this.state === GameState.WON;
  }

  /** Applies a difficulty right away, even mid-run. @param {import('./difficulty.js').Difficulty} difficulty */
  setDifficulty(difficulty) {
    const applied = this.tutorial ? DIFFICULTIES.easy : difficulty; // the tutorial is always gentle
    this.difficulty = applied;
    this.monster.setDifficulty(applied);
    this.flashlight.drainScale = applied.batteryDrain;
    this.keySense.cooldownScale = applied.senseCooldown;
  }

  /** @param {boolean} isPaused */
  setPaused(isPaused) {
    if (!isPaused) this.input.endFrame(); // the click that resumed the game must not also throw a bottle
    this.isPaused = isPaused;
    this.player.enabled = !isPaused && this.state === GameState.PLAYING;
    this.hud.setPaused(isPaused);
    this.audio.setPaused(isPaused);
    if (!isPaused && !this.hasShownSenseTip && !this.tutorial) {
      this.hasShownSenseTip = true;
      this.hud.toast('Lost? Press R to sense the nearest key');
    }
  }

  /** @param {number} dt @param {number} time elapsed seconds */
  update(dt, time) {
    this.world.update(dt);
    this.pickups.update(time);
    if (this.state === GameState.DYING) {
      this.updateJumpscare(dt);
      return;
    }
    if (this.isOver || this.isPaused) return;
    this.runTime += dt;
    if (this.state === GameState.GRABBED) {
      this.updateGrab(dt);
      this.updateHud();
      return;
    }

    if (this.hidingSpot) {
      this.updateHiding(dt);
    } else {
      this.player.update(dt);
      this.viewModel.update(dt, this.player);
    }
    this.graceTimer = Math.max(this.graceTimer - dt, 0);
    this.timeSinceHurt += dt;

    this.handleFlashlightInput();
    this.flashlight.update(dt);
    this.viewModel.setLensGlow(Math.min(this.flashlight.brightness, 1));
    this.handleInteraction();
    this.bag.handleInput(this.hidingSpot !== null);
    this.bag.update(dt);
    this.viewModel.hold(this.bag.inventory.selectedItem);
    this.updateKeySense(dt);
    this.updateRadios(dt);
    this.updateMonsterAtDoors();
    this.updateMonster(dt);
    this.audio.setChase(this.monster.state === MonsterState.CHASE);
    if (this.state !== GameState.PLAYING) return;
    this.events?.update(dt, {
      isBusy: this.monster.state === MonsterState.CHASE || this.hidingSpot !== null,
      keysFound: this.keysFound,
    });
    this.updateTutorial();

    this.checkEscape();
    this.updateFootsteps();
    this.regenerate(dt);
    this.updateSound(dt);
    this.updateMap();
    this.updateHud();
  }

  updateHud() {
    this.hud.update({
      health: this.health / MAX_HEALTH,
      keysFound: this.keysFound,
      totalKeys: this.totalKeys,
      pagesFound: this.pagesFound,
      totalPages: this.totalPages,
      battery: this.flashlight.battery,
      stamina: this.player.stamina / PLAYER_CONFIG.MAX_STAMINA,
      isExhausted: this.player.isExhausted,
      danger: this.state === GameState.GRABBED ? 1 : this.danger,
      alert: this.alertState,
      awareness: this.monster.state === MonsterState.CHASE ? 1 : this.monster.awareness,
      noise: this.hidingSpot ? 0 : Math.min(this.player.noiseRadius / LOUDEST_NOISE, 1),
      inventory: {
        slots: this.bag.inventory.slots.map((item) => item?.type ?? null),
        selected: this.bag.inventory.selected,
      },
    });
  }

  /** What the HUD eye shows: hidden, calm, suspicious (it is checking), hunted (chasing, lost you) or seen. */
  get alertState() {
    if (this.hidingSpot && !this.monster.sawHiding) return 'hidden';
    if (this.monster.state === MonsterState.CHASE) return this.monster.isPerceiving ? 'seen' : 'hunted';
    if (this.monster.state === MonsterState.SEARCH || this.monster.awareness > 0) return 'suspicious';
    return 'calm';
  }

  /** 0..1: how close and how angry the monster is. */
  get danger() {
    if (this.monster.isDormant) return 0;
    const proximity = THREE.MathUtils.clamp(1 - this.monster.distanceTo(this.player.position) / DANGER_RANGE, 0, 1);
    if (this.monster.state === MonsterState.CHASE) return Math.max(proximity, CHASE_MIN_DANGER);
    if (this.monster.state === MonsterState.STUNNED) return proximity * 0.4;
    return proximity * 0.7;
  }

  /** Heartbeat, breathing, and the echo of wherever the player stands. */
  updateSound(dt) {
    const stamina = this.player.stamina / PLAYER_CONFIG.MAX_STAMINA;
    this.audio.update(dt, this.danger, {
      exertion: this.player.isExhausted ? 1 : 1 - stamina,
      health: this.health / MAX_HEALTH,
      isHidden: this.hidingSpot !== null,
    });
    this.space = this.hidingSpot ? 'tight' : (spaceAt(this.level, this.rooms, this.player.position) ?? this.space);
    this.audio.setSpace(this.space);
  }

  handleFlashlightInput() {
    if (this.hidingSpot) return; // a light inside the locker would give you away
    if (this.input.wasPressed('KeyF')) {
      this.flashlight.toggle();
      this.audio.click();
    }
    if (!this.input.wasPressed('KeyQ') || !this.flashlight.burst()) return;

    this.audio.flash();
    if (!this.isMonsterInBeam()) return;
    this.monster.stun(FLASH_STUN);
    this.tutorial?.note('stunned');
    this.audio.growl(this.monster.position);
    this.hud.toast('It recoils from the light!');
  }

  isMonsterInBeam() {
    const distance = this.monster.distanceTo(this.player.position);
    if (distance > FLASH_RANGE || distance === 0) return false;
    const toMonsterX = (this.monster.position.x - this.player.position.x) / distance;
    const toMonsterZ = (this.monster.position.z - this.player.position.z) / distance;
    const facing = toMonsterX * -Math.sin(this.player.yaw) + toMonsterZ * -Math.cos(this.player.yaw);
    return facing >= FLASH_CONE_COS && hasLineOfSight(this.level, this.player.position, this.monster.position);
  }

  handleInteraction() {
    if (this.hidingSpot) {
      this.hud.setPrompt('[E] Get out');
      if (this.input.wasPressed('KeyE')) this.leaveHiding();
      return;
    }
    const action = this.findInteraction();
    this.hud.setPrompt(action?.prompt ?? '');
    if (action?.run && this.input.wasPressed('KeyE')) action.run();
  }

  /**
   * What E would do right now, nearest kind first: pick up, hide, door, radio.
   * @returns {{ prompt: string, run?: () => void } | null} no `run` = shown but not usable right now
   */
  findInteraction() {
    const item = this.pickups.findTarget(this.camera);
    if (item) {
      if (Inventory.accepts(item) && this.bag.inventory.isFull) {
        const held = this.bag.inventory.selectedItem;
        return {
          prompt: `[E] Swap your ${held.type} for the ${this.pickups.label(item)}`,
          run: () => this.bag.swapFor(item, (next) => this.pickUp(next)),
        };
      }
      const verb = item.type === PickupType.TAPE ? 'Play the' : 'Pick up';
      return { prompt: `[E] ${verb} ${this.pickups.label(item)}`, run: () => this.pickUp(item) };
    }
    const position = this.player.position;
    const locker = this.world.lockers.findNear(position);
    if (locker) return { prompt: '[E] Hide in the locker', run: () => this.enterHiding(locker) };
    const door = this.world.doors.findNear(position);
    if (door?.jamTimer > 0) return { prompt: 'The door is jammed' };
    if (door) return { prompt: `[E] ${door.isOpen ? 'Close' : 'Open'} the door`, run: () => this.useDoor(door) };
    if (this.world.isNearLockedDoor?.(position)) return { prompt: 'Locked. Chained shut from the other side' };
    const radio = this.world.radios.findNear(position);
    if (!radio) return null;
    if (radio.timeLeft > 0) return { prompt: 'The radio crackles…' };
    if (radio.cooldown > 0) return { prompt: 'The radio is dead for now' };
    return { prompt: '[E] Switch on the radio — the noise lures it there', run: () => this.useRadio(radio) };
  }

  /** @param {import('../world/doors.js').Door} door */
  useDoor(door) {
    const doors = this.world.doors;
    if (door.isOpen && (doors.isBlocked(door, this.player.position) || doors.isBlocked(door, this.monster.position))) {
      this.hud.toast('Something is in the way');
      return;
    }
    doors.setOpen(door, !door.isOpen);
    this.audio.doorCreak(door.position, 0.6);
    this.monster.hearNoise(door.position, DOOR_NOISE);
  }

  /** @param {import('../world/radios.js').Radio} radio */
  useRadio(radio) {
    if (!this.world.radios.switchOn(radio)) return;
    this.audio.radio(radio.position, radio.timeLeft);
    this.hud.toast('The radio blares into the dark...');
  }

  /** A playing radio keeps calling the monster over. */
  updateRadios(dt) {
    for (const radio of this.world.radios.update(dt)) this.monster.hearNoise(radio.position, RADIO_NOISE, true);
  }

  /** A closed door on its path: it stops, forces it open slowly, and the hinges scream. */
  updateMonsterAtDoors() {
    if (this.monster.isDormant || this.monster.holdTimer > 0) return;
    const door = this.world.doors.closedDoorAhead(this.monster.position, this.monster.nextCell);
    if (!door) return;
    this.monster.hold(MONSTER_DOOR_TIME);
    this.world.doors.forceOpen(door); // jammed for a while: no shutting it in its face again and again
    this.audio.doorCreak(door.position);
  }

  /** @param {import('../items/pickups.js').Pickup} item */
  pickUp(item) {
    this.pickups.take(item);
    this.audio.pickup();
    if (Inventory.accepts(item)) {
      this.bag.put(item);
    } else if (item.type === PickupType.KEY) {
      this.takeKey();
    } else if (item.type === PickupType.PAGE) {
      this.pagesFound++;
      this.revealNote(STORY_NOTES[this.pagesFound - 1]);
    } else if (item.type === PickupType.TAPE) {
      this.playTape(item);
    } else if (item.type === PickupType.MAP) {
      this.hasMap = true;
      this.hud.toast('Found a floor plan — press M to look at it');
    }
  }

  takeKey() {
    this.keysFound++;
    this.monster.setRage(this.keysFound);
    const lesson = this.tutorial ? undefined : LEARNING_TOASTS[this.keysFound];
    const count = `Key ${this.keysFound}/${this.totalKeys}`;
    if (this.keysFound === this.totalKeys) {
      this.openExit();
    } else if (this.keysFound > 1 && this.monster.distanceTo(this.player.position) < KEY_NOISE_RANGE) {
      this.monster.investigate(this.player.position); // it comes to check the clink, it does not know it was you
      this.hud.toast(`${count} — something heard that...${lesson ? ` ${lesson}` : ''}`);
    } else {
      this.hud.toast(lesson ? `${count}. ${lesson}` : count);
    }
  }

  /** A tape plays out loud: its transcript is shown, and the monster may hear it. @param {import('../items/pickups.js').Pickup} item */
  playTape(item) {
    const index = this.pickups.items.filter((other) => other.type === PickupType.TAPE).indexOf(item);
    this.revealNote(TAPES[Math.max(index, 0) % TAPES.length]);
    this.audio.tape(TAPE_PLAY_TIME);
    this.monster.hearNoise(this.player.position, TAPE_NOISE);
  }

  /** A journal page or a tape: shown as a card, then kept in the pause menu's Notes (not in the tutorial). */
  revealNote(note) {
    if (this.tutorial || !note) return;
    this.hud.showNote(note);
  }

  openExit() {
    this.isExitOpen = true;
    this.world.openExit();
    this.audio.doorOpen();
    this.monster.alert(this.player.position);
    this.hud.toast('The exit is open! RUN!');
  }

  // ---------- the floor plan: M shows it once found ----------

  updateMap() {
    if (this.input.wasPressed(MAP_KEY)) {
      if (this.hasMap) this.isMapOpen = !this.isMapOpen;
      else this.hud.toast('You have no map. A floor plan lies somewhere near where you woke.');
    }
    const { position, yaw } = this.player;
    this.hud.setMap(this.isMapOpen ? { x: position.x, z: position.z, yaw, isExitOpen: this.isExitOpen } : null);
  }

  // ---------- tutorial: one objective at a time; caught = back to the step's checkpoint ----------

  updateTutorial() {
    if (!this.tutorial?.update(this.tutorialSnapshot())) return;
    const step = this.tutorial.step;
    step.setup(this.director, false);
    if (step.tip) this.hud.toast(step.tip);
    this.hud.setObjective({ step: `${this.tutorial.index + 1}/${this.tutorial.steps.length}`, text: step.text });
  }

  /** @returns {import('./tutorial.js').TutorialSnapshot} */
  tutorialSnapshot() {
    return {
      cell: worldToCell(this.player.position.x, this.player.position.z),
      keysFound: this.keysFound,
      batteriesTaken: this.pickups.items.filter((item) => item.type === PickupType.BATTERY && item.isTaken).length,
      isHidden: this.hidingSpot !== null,
      monsterState: this.monster.state,
    };
  }

  /** Caught in the tutorial: no death, just back to the start of the step, which stages the monster again. */
  retryStep() {
    const step = this.tutorial.step;
    if (!step) return;
    if (this.hidingSpot) this.leaveHiding();
    const { x, z } = cellToWorld(step.checkpoint);
    this.player.position.set(x, 0, z);
    this.player.velocity.set(0, 0, 0);
    this.health = MAX_HEALTH;
    this.graceTimer = BREAK_FREE_GRACE;
    step.setup(this.director, true);
    this.audio.growl();
    this.hud.flash();
    this.hud.toast('It caught you. Try again from here.');
  }

  // ---------- key sense: R shows the way to the nearest key (or the exit once it is open) ----------

  updateKeySense(dt) {
    if (this.input.wasPressed('KeyR')) this.useKeySense();
    const route = this.keySense.update(dt, this.player.position, this.senseGoals());
    this.hud.setHint(
      route && {
        angle: this.screenAngleTo(route.aim),
        label: `${this.isExitOpen ? 'Exit' : 'Key'} · ${route.distance} m`,
      },
    );
  }

  useKeySense() {
    if (!this.keySense.activate()) {
      this.hud.toast(`You can sense again in ${Math.ceil(this.keySense.cooldown)} s`);
      return;
    }
    const route = this.keySense.update(0, this.player.position, this.senseGoals());
    this.audio.chime(route?.aim ?? null);
  }

  /** @returns {import('../level/level.js').Cell[]} */
  senseGoals() {
    if (this.isExitOpen) return [exitApproach(this.level)];
    return this.pickups.items.filter((item) => item.type === PickupType.KEY && !item.isTaken).map((item) => item.cell);
  }

  /** Angle of a world point from where the player looks: 0 = straight ahead, positive = to the right (radians). */
  screenAngleTo(point) {
    const dx = point.x - this.player.position.x;
    const dz = point.z - this.player.position.z;
    const sin = Math.sin(this.player.yaw);
    const cos = Math.cos(this.player.yaw);
    return Math.atan2(dx * cos - dz * sin, -dx * sin - dz * cos);
  }

  updateMonster(dt) {
    const event = this.monster.update(dt, {
      position: this.player.position,
      velocity: this.player.velocity,
      noiseRadius: this.hidingSpot ? 0 : this.player.noiseRadius,
      isCrouching: this.player.isCrouching,
      isLit: this.flashlight.isOn,
      isHidden: this.hidingSpot !== null,
    });
    if (event === 'caught') {
      if (this.graceTimer > 0) return;
      if (this.tutorial) {
        this.retryStep();
        return;
      }
      const sawHiding = this.monster.sawHiding;
      if (this.hidingSpot) {
        this.leaveHiding();
        this.hud.toast('It saw you hide!');
      }
      this.noteDeathContext(sawHiding);
      this.startGrab();
      return;
    }
    if (event === 'spotted') {
      this.audio.growl(this.monster.position);
      this.hud.flash();
    }
    this.updateMonsterSteps(dt);
  }

  updateMonsterSteps(dt) {
    const distance = this.monster.distanceTo(this.player.position);
    if (this.monster.speed < 0.2 || distance > MONSTER_HEARING_RANGE) return;
    this.monsterStepTimer -= (dt * this.monster.speed) / MONSTER_STEP_REFERENCE_SPEED;
    if (this.monsterStepTimer > 0) return;
    this.monsterStepTimer = MONSTER_STEP_INTERVAL;
    const muffle = hasLineOfSight(this.level, this.monster.position, this.player.position) ? 1 : WALL_MUFFLE_VOLUME;
    this.audio.monsterStep(muffle, this.monster.position); // the audio panner handles the distance fall-off
    const cell = worldToCell(this.monster.position.x, this.monster.position.z);
    const floor = noisyFloorAt(this.level, cell.x, cell.z);
    if (floor) this.audio.floorNoise(floor.sound, muffle, this.monster.position); // you can hear it crunch
  }

  updateFootsteps() {
    const step = Math.floor(this.player.bobPhase / Math.PI);
    if (step === this.lastStep) return;
    this.lastStep = step;
    if (!this.player.isGrounded) return;
    const { isSprinting, isCrouching, isWalkingQuietly } = this.player;
    const volume = isSprinting
      ? FOOTSTEP_VOLUME.sprint
      : isCrouching
        ? FOOTSTEP_VOLUME.crouch
        : isWalkingQuietly
          ? FOOTSTEP_VOLUME.quiet
          : FOOTSTEP_VOLUME.walk;
    this.audio.footstep(volume);
    this.stepOnNoisyFloor(isCrouching || isWalkingQuietly);
  }

  /** Glass and loose boards: a careless step is loud enough for it to hear; a careful one only whispers. */
  stepOnNoisyFloor(isCareful) {
    const { x, z } = worldToCell(this.player.position.x, this.player.position.z);
    const floor = noisyFloorAt(this.level, x, z);
    if (!floor) return;
    this.audio.floorNoise(floor.sound, isCareful ? CAREFUL_FLOOR_VOLUME : 1);
    if (isCareful) return;
    this.monster.hearNoise(this.player.position, floor.radius);
    if (this.floorTips.has(floor.sound)) return;
    this.floorTips.add(floor.sound);
    this.hud.toast(floor.tip);
  }

  regenerate(dt) {
    if (this.timeSinceHurt < REGEN_DELAY || this.monster.state === MonsterState.CHASE) return;
    this.health = Math.min(this.health + HEALTH_REGEN * dt, MAX_HEALTH);
  }

  /** A bandage. @param {number} amount @returns {boolean} false when not hurt (nothing to heal) */
  heal(amount) {
    if (this.health >= MAX_HEALTH - 1) return false;
    this.health = Math.min(this.health + amount, MAX_HEALTH);
    return true;
  }

  hurt(amount) {
    this.health = Math.max(this.health - amount, 0);
    this.timeSinceHurt = 0;
    this.hud.flash();
  }

  // ---------- hiding in a locker ----------

  /** @param {import('../world/lockers.js').HidingSpot} spot */
  enterHiding(spot) {
    const player = this.player;
    this.hidingSpot = spot;
    player.position.copy(spot.inside);
    player.velocity.set(0, 0, 0);
    player.yaw = spot.yaw;
    player.pitch = 0;
    player.isCrouching = player.isSprinting = player.isWalkingQuietly = false;
    player.height = PLAYER_CONFIG.STAND_HEIGHT;
    player.state = PlayerState.IDLE;

    this.wasLightOn = this.flashlight.isOn;
    if (this.flashlight.isOn) this.flashlight.toggle();
    this.viewModel.setShown(false);
    this.audio.lockerDoor();
  }

  leaveHiding() {
    this.player.position.copy(this.hidingSpot.front);
    this.hidingSpot = null;
    if (this.wasLightOn && !this.flashlight.isOn) this.flashlight.toggle();
    this.viewModel.setShown(true);
    this.audio.lockerDoor();
  }

  /** Peeking through the slits: the head turns only so far. */
  updateHiding(dt) {
    const { clamp, euclideanModulo } = THREE.MathUtils;
    const player = this.player;
    const turn = euclideanModulo(player.yaw - this.hidingSpot.yaw + Math.PI, Math.PI * 2) - Math.PI;
    player.yaw = this.hidingSpot.yaw + clamp(turn, -HIDE_LOOK_YAW, HIDE_LOOK_YAW);
    player.pitch = clamp(player.pitch, -HIDE_LOOK_PITCH, HIDE_LOOK_PITCH);
    player.updateCamera(dt);
  }

  // ---------- grabbed: mash Space to break free ----------

  /** Remembers how it got hold of the player, for the tip on the death screen. @param {boolean} sawHiding */
  noteDeathContext(sawHiding) {
    this.deathContext = {
      spottedBy: this.monster.lastSense,
      wasLit: this.wasLightOn || this.flashlight.isOn,
      wasSprinting: this.player.isSprinting,
      sawHiding,
      hadLure: this.bag.hasLure,
      couldFlash: this.flashlight.battery >= FLASH_MIN_BATTERY,
      struggle: 1,
    };
  }

  startGrab() {
    this.hurt(GRAB_DAMAGE);
    if (this.health <= 0) {
      this.startJumpscare();
      return;
    }
    this.state = GameState.GRABBED;
    this.player.enabled = false;
    this.isMapOpen = false;
    this.hud.setMap(null);
    this.grab = { time: 0, progress: 0, best: 0 };
    this.closeUp.start();
    this.audio.growl();
    this.hud.setPrompt('');
    this.hud.setStruggle(0);
  }

  updateGrab(dt) {
    const grab = this.grab;
    grab.time += dt;
    if (this.input.wasPressed('Space')) grab.progress += STRUGGLE_PER_PRESS;
    grab.progress = Math.max(grab.progress - STRUGGLE_DECAY * dt, 0);
    grab.best = Math.max(grab.best, Math.min(grab.progress, 1));
    this.health = Math.max(this.health - GRAB_DAMAGE_PER_SECOND * dt, 0);
    this.timeSinceHurt = 0;

    this.monster.mixer?.update(dt);
    this.closeUp.frame(GRAB_SHOT, grab.time);
    this.audio.update(dt, 1);
    this.hud.setStruggle(Math.min(grab.progress, 1));

    if (grab.progress >= 1) this.breakFree();
    else if (this.health <= 0 || grab.time >= GRAB_TIMEOUT) this.startJumpscare();
  }

  breakFree() {
    this.state = GameState.PLAYING;
    this.hud.setStruggle(null);
    this.monster.stun(BREAK_FREE_STUN);
    this.graceTimer = BREAK_FREE_GRACE;
    this.player.stamina = PLAYER_CONFIG.MAX_STAMINA; // adrenaline
    this.player.isExhausted = false;
    this.player.enabled = !this.isPaused;
    this.closeUp.end();
    this.hud.toast('You broke free! RUN!');
  }

  // ---------- endings ----------

  checkEscape() {
    if (!this.isExitOpen) return;
    const cell = worldToCell(this.player.position.x, this.player.position.z);
    if (cell.x !== this.level.exit.x || cell.z !== this.level.exit.z) return;

    this.state = GameState.WON;
    this.endRun();
    if (this.tutorial) {
      this.hud.showEnd(true, 'You know how to survive it now. The real hospital is waiting...', {
        title: 'TUTORIAL COMPLETE',
        hint: 'Click to play the real game',
      });
      return;
    }
    const endingName = endingFor(this.pagesFound, this.totalPages);
    const ending = ENDINGS[endingName];
    const recorded = this.recordRun(true, endingName);
    const best = recorded?.records.bestTimes[this.difficulty.name];
    this.hud.showEnd(true, ending.text, {
      title: ending.title,
      badge: recorded?.isNewBest ? 'New best time!' : null,
      stats: [
        ['Escaped in', formatTime(this.runTime)],
        ['Difficulty', this.difficulty.label],
        ['Journal', `${this.pagesFound}/${this.totalPages} pages`],
        ...(best !== undefined ? [['Best time', formatTime(best)]] : []),
      ],
    });
  }

  startJumpscare() {
    const wasGrabbed = this.state === GameState.GRABBED;
    this.state = GameState.DYING;
    this.shotTime = 0;
    this.health = 0;
    if (this.deathContext) this.deathContext = { ...this.deathContext, struggle: this.grab.best };
    this.endRun();
    this.hud.setStruggle(null);
    if (!wasGrabbed) this.closeUp.start(); // when grabbed, keep the framing: it rears back and lunges
    this.audio.scream();
    this.hud.flash();
  }

  updateJumpscare(dt) {
    this.shotTime += dt;
    this.closeUp.frame(JUMPSCARE_SHOT, this.shotTime);
    if (this.shotTime < JUMPSCARE_SHOT.duration) return;
    this.state = GameState.DEAD;
    this.recordRun(false, null);
    this.hud.showEnd(false, `It caught you on ${this.difficulty.label}.`, {
      stats: [
        ['Survived', formatTime(this.runTime)],
        ['Keys', `${this.keysFound}/${this.totalKeys}`],
        ['Journal', `${this.pagesFound}/${this.totalPages} pages`],
      ],
      tip: this.deathContext ? deathTip(this.deathContext) : null,
    });
  }

  /**
   * @param {boolean} isWin @param {import('./story.js').EndingName | null} ending
   * @returns {import('./records.js').RecordedRun | null} null in the tutorial or without a record book
   */
  recordRun(isWin, ending) {
    if (this.tutorial || !this.recordBook) return null;
    return this.recordBook.record({
      isWin,
      time: this.runTime,
      difficulty: this.difficulty.name,
      pagesFound: this.pagesFound,
      ending,
    });
  }

  /** Stops input and releases the mouse once the run is decided. */
  endRun() {
    this.player.enabled = false;
    this.isMapOpen = false;
    this.hud.setMap(null);
    this.audio.setChase(false);
    this.hud.setPrompt('');
    document.exitPointerLock();
  }
}
