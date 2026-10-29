/** @typedef {'easy' | 'normal' | 'hard'} DifficultyName */

/**
 * @typedef {{ name: DifficultyName, label: string, monsterSpeed: number, hearing: number, batteryDrain: number, senseCooldown: number }} Difficulty
 *   Every number scales a tunable of Normal: the monster's speeds, how far it hears, how fast the flashlight drains,
 *   and how long R (key sense) needs to recover.
 */

/** @type {Readonly<Record<DifficultyName, Readonly<Difficulty>>>} */
export const DIFFICULTIES = Object.freeze({
  easy: Object.freeze({
    name: 'easy',
    label: 'Easy',
    monsterSpeed: 0.85,
    hearing: 0.7,
    batteryDrain: 0.6,
    senseCooldown: 0.5,
  }),
  normal: Object.freeze({
    name: 'normal',
    label: 'Normal',
    monsterSpeed: 1,
    hearing: 1,
    batteryDrain: 1,
    senseCooldown: 1,
  }),
  hard: Object.freeze({
    name: 'hard',
    label: 'Hard',
    monsterSpeed: 1.15,
    hearing: 1.3,
    batteryDrain: 1.5,
    senseCooldown: 1.6,
  }),
});

/** @type {readonly DifficultyName[]} */
export const DIFFICULTY_NAMES = Object.freeze(/** @type {DifficultyName[]} */ (Object.keys(DIFFICULTIES)));
