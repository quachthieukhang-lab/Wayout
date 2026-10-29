import * as THREE from 'three';
import { Easing } from '@tweenjs/tween.js';
import { worldToCell, cellToWorld, exitApproach, noisyFloorAt } from '../level/level.js';
import { RADIO_NOISE } from '../world/radios.js';
import { KeySense } from '../items/key-sense.js';
import { hasLineOfSight } from '../level/pathfinding.js';
import { MonsterState } from '../monster/monster.js';
import { PickupType } from '../items/pickups.js';
import { PLAYER_CONFIG, PlayerState } from '../player/player.js';
import { THROWABLE, THROW_SPEED, Throwing } from '../items/throwables.js';
import { Inventory, INVENTORY_SLOTS } from '../items/inventory.js';
import { DIFFICULTIES } from './difficulty.js';
import { STORY_NOTES } from './story.js';

export const GameState = Object.freeze({
  PLAYING: 'playing',
  GRABBED: 'grabbed',
  DYING: 'dying',
  DEAD: 'dead',
  WON: 'won',
});

const BATTERY_RECHARGE = 0.45;
const FULL_BATTERY = 0.99; // a fresh battery would be wasted above this
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
const USE_KEYS = ['KeyG', 'Mouse0']; // throw the selected bottle or can, or put the selected battery in
const DROP_KEY = 'KeyX';
const DROP_AHEAD = 0.3; // m in front of the feet: less than the player's radius, so never inside a wall
const DROP_VOLUME = 0.15;
const SLOT_KEYS = Array.from({ length: INVENTORY_SLOTS }, (_, i) => `Digit${i + 1}`);
/** Shown the first time each kind of item goes in the bag. */
const ITEM_TIPS = Object.freeze({
  [PickupType.BOTTLE]: 'Picked up a bottle — press G or click to throw it and lure it away',
  [PickupType.CAN]: 'Picked up a can — press G or click to throw it and lure it away',
  [PickupType.BATTERY]: 'Battery in your bag — select it and press G or click to put it in the flashlight',
});
const MONSTER_DOOR_TIME = 1.4; // s it spends forcing a closed door
const DOOR_NOISE = 6; // m a door the player swings can be heard
const CAREFUL_FLOOR_VOLUME = 0.25; // glass and boards still whisper under a careful step

const GRAB_DAMAGE = 20;
const GRAB_DAMAGE_PER_SECOND = 7;
const GRAB_TIMEOUT = 5; // fail to break free in time and it kills you
const STRUGGLE_PER_PRESS = 0.16;
const STRUGGLE_DECAY = 0.3; // per second
const BREAK_FREE_STUN = 3.5;
const BREAK_FREE_GRACE = 2; // seconds it cannot grab you again

const FLASH_STUN = 3;
const FLASH_RANGE = 10;
const FLASH_CONE_COS = Math.cos(THREE.MathUtils.degToRad(18));

const FACE_FROM_TOP = 0.12; // face height as a fraction of the model height, measured from the top
const JUMPSCARE_SHOT = Object.freeze({
  fromDistance: 1.6,
  toDistance: 0.45,
  fov: 35,
  shake: 0.08,
  rise: 0.6,
  zoomTime: 0.35,
  duration: 2,
});
const GRAB_SHOT = Object.freeze({
  fromDistance: 1.2,
  toDistance: 0.85,
  fov: 60,
  shake: 0.035,
  rise: 0.25,
  zoomTime: 0.25,
  duration: GRAB_TIMEOUT,
});

/** Rules of the horror game: pickups, health, the monster, escaping its grip, the exit, and the jumpscare. */
export class Game {
  /**
   * @param {{
   *   level: import('../level/level.js').Level, camera: THREE.PerspectiveCamera, input: import('./input.js').Input,
   *   player: import('../player/player.js').Player, viewModel: import('../player/viewmodel.js').ViewModel,
   *   flashlight: import('../player/flashlight.js').Flashlight, monster: import('../monster/monster.js').Monster,
   *   pickups: ReturnType<typeof import('../items/pickups.js').createPickups>, world: ReturnType<typeof import('../world/world.js').createWorld>,
   *   audio: import('../audio/audio.js').HorrorAudio, hud: ReturnType<typeof import('../ui/hud.js').createHud>,
   *   tutorial?: import('./tutorial.js').Tutorial | null
   * }} deps
   */
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
    /** @type {typeof GameState[keyof typeof GameState]} */
    this.state = GameState.PLAYING;
    this.isPaused = true;
    this.health = MAX_HEALTH;
    this.timeSinceHurt = Infinity;
    this.graceTimer = 0;
    this.keysFound = 0;
    this.totalKeys = deps.level.keys.length;
    this.isExitOpen = false;
    this.lastStep = 0;
    this.monsterStepTimer = 0;
    this.grab = { time: 0, progress: 0 };
    this.shotTime = 0;
    this.hidingSpot = null;
    this.wasLightOn = false;
    this.keySense = new KeySense(deps.level);
    this.hasShownSenseTip = false;
    this.throwing = new Throwing(deps.world.scene, deps.world.colliders);
    this.inventory = new Inventory();
    this.itemTips = new Set(); // item kinds whose use was already explained
    this.floorTips = new Set(); // noisy floor kinds already explained
    /** @type {import('./difficulty.js').Difficulty} */
    this.difficulty = DIFFICULTIES.normal;
    this.tutorial = deps.tutorial ?? null;
    this.director = this.createMonsterDirector();

    this._cameraBase = new THREE.Vector3();
    this._forward = { x: 0, z: -1 };
    this._faceHeight = 0;
    this._startFov = deps.camera.fov;
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
    this.handleItemInput();
    this.updateThrown(dt);
    this.updateKeySense(dt);
    this.updateRadios(dt);
    this.updateMonsterAtDoors();
    this.updateMonster(dt);
    this.audio.setChase(this.monster.state === MonsterState.CHASE);
    if (this.state !== GameState.PLAYING) return;
    this.updateTutorial();

    this.checkEscape();
    this.updateFootsteps();
    this.regenerate(dt);
    this.audio.update(dt, this.danger);
    this.updateHud();
  }

  updateHud() {
    this.hud.update({
      health: this.health / MAX_HEALTH,
      keysFound: this.keysFound,
      totalKeys: this.totalKeys,
      battery: this.flashlight.battery,
      stamina: this.player.stamina / PLAYER_CONFIG.MAX_STAMINA,
      isExhausted: this.player.isExhausted,
      danger: this.state === GameState.GRABBED ? 1 : this.danger,
      alert: this.alertState,
      awareness: this.monster.state === MonsterState.CHASE ? 1 : this.monster.awareness,
      noise: this.hidingSpot ? 0 : Math.min(this.player.noiseRadius / LOUDEST_NOISE, 1),
      inventory: { slots: this.inventory.slots.map((item) => item?.type ?? null), selected: this.inventory.selected },
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
      if (Inventory.accepts(item) && this.inventory.isFull) {
        const held = this.inventory.selectedItem;
        return {
          prompt: `[E] Swap your ${held.type} for the ${this.pickups.label(item)}`,
          run: () => this.swapFor(item),
        };
      }
      return { prompt: `[E] Pick up ${this.pickups.label(item)}`, run: () => this.pickUp(item) };
    }
    const position = this.player.position;
    const locker = this.world.lockers.findNear(position);
    if (locker) return { prompt: '[E] Hide in the locker', run: () => this.enterHiding(locker) };
    const door = this.world.doors.findNear(position);
    if (door?.jamTimer > 0) return { prompt: 'The door is jammed' };
    if (door) return { prompt: `[E] ${door.isOpen ? 'Close' : 'Open'} the door`, run: () => this.useDoor(door) };
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
    for (const radio of this.world.radios.update(dt)) this.monster.hearNoise(radio.position, RADIO_NOISE);
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

  pickUp(item) {
    this.pickups.take(item);
    this.audio.pickup();
    if (Inventory.accepts(item)) {
      this.inventory.add(item);
      this.hud.toast(this.itemTips.has(item.type) ? `Picked up a ${item.type}` : ITEM_TIPS[item.type]);
      this.itemTips.add(item.type);
      return;
    }

    this.keysFound++;
    this.monster.setRage(this.keysFound);
    this.revealNote();
    if (this.keysFound === this.totalKeys) {
      this.openExit();
    } else if (this.keysFound > 1 && this.monster.distanceTo(this.player.position) < KEY_NOISE_RANGE) {
      this.monster.investigate(this.player.position); // it comes to check the clink, it does not know it was you
      this.hud.toast(`Key ${this.keysFound}/${this.totalKeys} — something heard that...`);
    } else {
      this.hud.toast(`Key ${this.keysFound}/${this.totalKeys}`);
    }
  }

  /** Each key carries the next page of Marrow's journal (not in the tutorial, which has its own objectives). */
  revealNote() {
    const note = STORY_NOTES[this.keysFound - 1];
    if (this.tutorial || !note) return;
    this.hud.showNote(note);
  }

  /** The bag is full: the selected item goes down where the new one lay. @param {import('../items/pickups.js').Pickup} item */
  swapFor(item) {
    const { x, z } = item.mesh.position;
    const dropped = this.inventory.removeSelected();
    this.pickUp(item); // into the slot just emptied
    this.pickups.drop(dropped, { x, z });
  }

  openExit() {
    this.isExitOpen = true;
    this.world.openExit();
    this.audio.doorOpen();
    this.monster.alert(this.player.position);
    this.hud.toast('The exit is open! RUN!');
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

  /** @returns {import('./tutorial.js').MonsterDirector} how tutorial steps stage the monster */
  createMonsterDirector() {
    const monster = this.monster;
    const wake = () => monster.setDormant(false);
    return {
      sleep: () => monster.setDormant(true),
      place: (cell) => {
        wake();
        monster.place(cell);
      },
      investigate: (cell, area) => {
        wake();
        monster.setPatrolArea(area);
        const { x, z } = cellToWorld(cell);
        monster.investigate(new THREE.Vector3(x, 0, z));
      },
      guard: (area) => {
        wake();
        monster.setPatrolArea(area);
        monster.calm();
      },
      charge: (roarSeconds) => {
        wake();
        monster.setPatrolArea(null);
        monster.alert(this.player.position, roarSeconds);
        this.audio.growl(monster.position);
      },
    };
  }

  // ---------- the bag: 1-4 or the wheel select a slot, G / click use it, X drops it ----------

  handleItemInput() {
    const input = this.input;
    const inventory = this.inventory;
    SLOT_KEYS.forEach((code, index) => {
      if (input.wasPressed(code)) inventory.select(index);
    });
    if (input.wasPressed('WheelDown')) inventory.cycle(1);
    if (input.wasPressed('WheelUp')) inventory.cycle(-1);
    if (this.hidingSpot) return;
    if (input.wasPressed(...USE_KEYS)) this.useSelected();
    else if (input.wasPressed(DROP_KEY)) this.dropSelected();
  }

  /** A bottle or can is thrown; a battery goes into the flashlight. */
  useSelected() {
    const item = this.inventory.selectedItem;
    if (!item) return;
    if (item.type === PickupType.BATTERY) {
      if (this.flashlight.battery >= FULL_BATTERY) {
        this.hud.toast('The flashlight is still full');
        return;
      }
      this.inventory.removeSelected();
      this.flashlight.recharge(BATTERY_RECHARGE);
      this.audio.click();
      this.hud.toast('Fresh battery in the flashlight');
      return;
    }
    this.inventory.removeSelected();
    this.throwing.throwFrom(item, this.camera, this.player.velocity);
    this.audio.whoosh();
  }

  /** Sets the selected item down just in front of the feet, freeing the slot. */
  dropSelected() {
    const item = this.inventory.removeSelected();
    if (!item) return;
    const { position, yaw } = this.player;
    const point = { x: position.x - Math.sin(yaw) * DROP_AHEAD, z: position.z - Math.cos(yaw) * DROP_AHEAD };
    this.pickups.drop(item, point);
    this.audio.clank(DROP_VOLUME, item.mesh.position);
  }

  // ---------- throwing: a bottle or can lands with a noise that draws it away ----------

  updateThrown(dt) {
    const { impacts, rested } = this.throwing.update(dt);
    for (const impact of impacts) {
      if (impact.breaks) this.audio.shatter(impact.position);
      else this.audio.clank(Math.min(impact.speed / THROW_SPEED, 1), impact.position);
      if (!impact.isFirst) continue;
      if (this.monster.hearNoise(impact.position, THROWABLE[impact.item.type].noiseRadius)) {
        this.hud.toast('It heard that...');
      }
    }
    rested.forEach((item) => this.pickups.putBack(item));
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
      if (this.hidingSpot) {
        this.leaveHiding();
        this.hud.toast('It saw you hide!');
      }
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

  startGrab() {
    this.hurt(GRAB_DAMAGE);
    if (this.health <= 0) {
      this.startJumpscare();
      return;
    }
    this.state = GameState.GRABBED;
    this.player.enabled = false;
    this.grab = { time: 0, progress: 0 };
    this.startCloseUp();
    this.audio.growl();
    this.hud.setPrompt('');
    this.hud.setStruggle(0);
  }

  updateGrab(dt) {
    const grab = this.grab;
    grab.time += dt;
    if (this.input.wasPressed('Space')) grab.progress += STRUGGLE_PER_PRESS;
    grab.progress = Math.max(grab.progress - STRUGGLE_DECAY * dt, 0);
    this.health = Math.max(this.health - GRAB_DAMAGE_PER_SECOND * dt, 0);
    this.timeSinceHurt = 0;

    this.monster.mixer?.update(dt);
    this.frameCloseUp(GRAB_SHOT, grab.time);
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
    this.viewModel.setShown(true);
    this.camera.fov = this._startFov;
    this.camera.updateProjectionMatrix();
    this.hud.toast('You broke free! RUN!');
  }

  // ---------- close-up framing shared by the grab and the jumpscare ----------

  /** Turns player and monster to face each other along the line between them, then measures its face. */
  startCloseUp() {
    const dx = this.monster.position.x - this.player.position.x;
    const dz = this.monster.position.z - this.player.position.z;
    const length = Math.hypot(dx, dz) || 1;
    this._forward = { x: dx / length, z: dz / length };

    // Same formula for both: player forward is (-sin, -cos), the monster model faces (sin, cos).
    const yaw = Math.atan2(-this._forward.x, -this._forward.z);
    this.player.yaw = yaw;
    this.player.pitch = 0;
    this.monster.yaw = yaw;
    this.monster.object.rotation.y = yaw;
    this.monster.body.rotation.set(0, 0, 0); // no lean, so the face stays where we aim

    const box = new THREE.Box3().setFromObject(this.monster.body);
    this._faceHeight = box.max.y - (box.max.y - box.min.y) * FACE_FROM_TOP;
    this._cameraBase.copy(this.camera.position);
    this._startFov = this.camera.fov;
    this.viewModel.setShown(false); // arms and flashlight would block the face
  }

  /** Lunge + zoom: the monster closes in, the lens narrows and rises to its face, the view shakes. */
  frameCloseUp(shot, time) {
    const { lerp } = THREE.MathUtils;
    const ease = Easing.Cubic.Out(Math.min(time / shot.zoomTime, 1)); // fast in, then settles on the face

    const distance = lerp(shot.fromDistance, shot.toDistance, ease);
    const base = this._cameraBase;
    this.monster.position.set(base.x + this._forward.x * distance, 0, base.z + this._forward.z * distance);

    this.camera.fov = lerp(this._startFov, shot.fov, ease);
    this.camera.updateProjectionMatrix();

    const shake = Math.max(0, 1 - time / shot.duration) * shot.shake;
    const jitter = () => (Math.random() - 0.5) * shake;
    const eyeY = lerp(base.y, this._faceHeight, ease * shot.rise);
    this.camera.position.set(base.x + jitter(), eyeY + jitter(), base.z + jitter());
    this.camera.lookAt(this.monster.position.x, this._faceHeight, this.monster.position.z);
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
    this.hud.showEnd(
      true,
      `You made it out on ${this.difficulty.label}. It is still standing in the dark, waiting for the next one...`,
    );
  }

  startJumpscare() {
    const wasGrabbed = this.state === GameState.GRABBED;
    this.state = GameState.DYING;
    this.shotTime = 0;
    this.health = 0;
    this.endRun();
    this.hud.setStruggle(null);
    if (!wasGrabbed) this.startCloseUp(); // when grabbed, keep the framing: it rears back and lunges
    this.audio.scream();
    this.hud.flash();
  }

  updateJumpscare(dt) {
    this.shotTime += dt;
    this.frameCloseUp(JUMPSCARE_SHOT, this.shotTime);
    if (this.shotTime < JUMPSCARE_SHOT.duration) return;
    this.state = GameState.DEAD;
    this.hud.showEnd(
      false,
      `It caught you on ${this.difficulty.label}. Keys found: ${this.keysFound}/${this.totalKeys}`,
    );
  }

  /** Stops input and releases the mouse once the run is decided. */
  endRun() {
    this.player.enabled = false;
    this.audio.setChase(false);
    this.hud.setPrompt('');
    document.exitPointerLock();
  }
}
