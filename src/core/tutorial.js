import * as THREE from 'three';
import { roomAt, cellToWorld } from '../level/level.js';
import { TUTORIAL_ROOMS } from '../level/tutorial-map.js';

// Spots on TUTORIAL_MAP the steps stage the monster with.
const SUPPLY_DOOR = Object.freeze({ x: 17, z: 8 }); // just inside the supply room, out of sight of the lockers
const LOCKER_SPOT = Object.freeze({ x: 24, z: 7 }); // where it comes to check while the player hides
const GUARD_POST = Object.freeze({ x: 10, z: 8 }); // beside the door to the exit hall
const GUARD_AREA = Object.freeze({ x0: 9, z0: 6, x1: 11, z1: 10 }); // the strip of the supply room it guards
const CHARGE_FROM = Object.freeze({ x: 13, z: 8 }); // it charges the exit hall from here
const CHARGE_ROAR = 1.2; // seconds it roars before charging, so the player can turn and aim

/**
 * What a step uses to stage the monster; Game implements it.
 * @typedef {{
 *   sleep: () => void,
 *   place: (cell: import('../level/level.js').Cell) => void,
 *   investigate: (cell: import('../level/level.js').Cell, area: Area) => void,
 *   guard: (area: Area) => void,
 *   charge: (roarSeconds: number) => void,
 * }} MonsterDirector
 * @typedef {{ x0: number, z0: number, x1: number, z1: number }} Area
 * @typedef {{ cell: import('../level/level.js').Cell, keysFound: number, batteriesTaken: number, isHidden: boolean,
 *   monsterState: string }} TutorialSnapshot
 * @typedef {TutorialSnapshot & { room: string | null }} StepState
 * @typedef {{
 *   text: string, tip?: string, checkpoint: import('../level/level.js').Cell,
 *   setup: (monster: MonsterDirector, isRetry: boolean) => void,
 *   isDone: (state: StepState, flags: ReadonlySet<string>) => boolean,
 * }} TutorialStep
 */

/** @type {readonly TutorialStep[]} */
export const TUTORIAL_STEPS = Object.freeze([
  {
    text: 'Look around with the mouse and walk out of the room (W A S D)',
    checkpoint: { x: 2, z: 2 },
    setup: (monster) => monster.sleep(),
    isDone: (state) => state.room === 'QUIET HALL',
  },
  {
    text: 'Hold Z to walk quietly to the end of the hall. Keep the Noise meter low',
    tip: 'It hears footsteps, and broken glass crunches. Sprinting (Shift) is fast, but very loud.',
    checkpoint: { x: 6, z: 2 },
    setup: (monster) => monster.sleep(),
    isDone: (state) => state.room === 'QUIET HALL' && state.cell.x >= 14,
  },
  {
    text: 'Hold C to crouch and crawl through the vent',
    tip: 'It is too big to follow you through a vent.',
    checkpoint: { x: 14, z: 2 },
    setup: (monster) => monster.sleep(),
    isDone: (state) => state.room === 'DARK ROOM',
  },
  {
    text: 'Press F for the flashlight, then pick up the battery (E). It goes in your bag',
    tip: 'With the light on, it can see you from farther away. When it runs low, select the battery (1-4) and click.',
    checkpoint: { x: 17, z: 2 },
    setup: (monster) => monster.sleep(),
    isDone: (state) => state.batteriesTaken >= 1,
  },
  {
    text: 'Press R to sense the key, follow the arrow and pick it up (E)',
    checkpoint: { x: 23, z: 2 },
    setup: (monster) => monster.sleep(),
    isDone: (state) => state.keysFound >= 1,
  },
  {
    text: 'Something is coming! Hide in a locker (E) and wait until it gives up',
    tip: 'It will not find you in a locker, unless it sees you climb in.',
    checkpoint: { x: 25, z: 6 },
    setup: (monster) => {
      monster.place(SUPPLY_DOOR);
      monster.investigate(LOCKER_SPOT, GUARD_AREA);
    },
    isDone: (state, flags) => flags.has('hid') && state.monsterState === 'patrol',
  },
  {
    text: 'It guards the far door. Select the bottle (1-4) and throw it (G / click) away from it, then slip past',
    tip: 'Bottles smash loudly. Cans are quieter, but you can pick them up again.',
    checkpoint: { x: 21, z: 8 },
    setup: (monster, isRetry) => {
      if (isRetry) monster.place(GUARD_POST);
      monster.guard(GUARD_AREA);
    },
    isDone: (state) => state.room === 'EXIT HALL',
  },
  {
    text: 'It is charging! Keep the light on, face it and press Q to blind it',
    checkpoint: { x: 3, z: 8 },
    setup: (monster) => {
      monster.place(CHARGE_FROM);
      monster.charge(CHARGE_ROAR);
    },
    isDone: (_state, flags) => flags.has('stunned'),
  },
  {
    text: 'Grab the last key and the exit opens. Get out!',
    checkpoint: { x: 3, z: 8 },
    setup: (monster, isRetry) => {
      if (!isRetry) return; // it is still reeling from the flash
      monster.place(CHARGE_FROM);
      monster.charge(CHARGE_ROAR);
    },
    isDone: () => false, // reaching the exit ends the run
  },
]);

/** Walks the player through TUTORIAL_STEPS: one objective at a time, each with a checkpoint to retry from. */
export class Tutorial {
  /** @param {readonly import('../level/level.js').Room[]} [rooms] @param {readonly TutorialStep[]} [steps] */
  constructor(rooms = TUTORIAL_ROOMS, steps = TUTORIAL_STEPS) {
    this.rooms = rooms;
    this.steps = steps;
    this.index = 0;
    this.hasStarted = false;
    /** @type {Set<string>} things that happened during the current step, e.g. 'hid', 'stunned' */
    this.flags = new Set();
  }

  /** @returns {TutorialStep | null} null once every step is done */
  get step() {
    return this.steps[this.index] ?? null;
  }

  /** @param {string} flag something the step may be waiting for, e.g. 'stunned' */
  note(flag) {
    this.flags.add(flag);
  }

  /**
   * @param {TutorialSnapshot} snapshot
   * @returns {boolean} whether a new step just began (the first call always begins step 1)
   */
  update(snapshot) {
    if (!this.hasStarted) {
      this.hasStarted = true;
      return true;
    }
    const step = this.step;
    if (!step) return false;
    if (snapshot.isHidden) this.flags.add('hid');
    const room = roomAt(this.rooms, snapshot.cell)?.name ?? null;
    if (!step.isDone({ ...snapshot, room }, this.flags)) return false;
    this.index++;
    this.flags = new Set();
    return this.step !== null;
  }
}

/**
 * How tutorial steps stage the monster.
 * @param {import('../monster/monster.js').Monster} monster
 * @param {{ position: THREE.Vector3 }} player
 * @param {{ growl: (position?: { x: number, z: number }) => void }} audio
 * @returns {MonsterDirector}
 */
export function createMonsterDirector(monster, player, audio) {
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
      monster.alert(player.position, roarSeconds);
      audio.growl(monster.position);
    },
  };
}
