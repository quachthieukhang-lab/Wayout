import * as z from 'zod/mini';
import { DIFFICULTY_NAMES } from './difficulty.js';

const STORAGE_KEY = 'way-out-records';
const ENDING_NAMES = /** @type {const} */ (['truth', 'partial', 'blind']);

/**
 * What the player has achieved across runs, kept in localStorage.
 * @typedef {{
 *   bestTimes: Partial<Record<import('./difficulty.js').DifficultyName, number>>, mostPages: number,
 *   escapes: number, deaths: number, endings: import('./story.js').EndingName[]
 * }} Records
 * @typedef {{
 *   isWin: boolean, time: number, difficulty: import('./difficulty.js').DifficultyName, pagesFound: number,
 *   ending: import('./story.js').EndingName | null
 * }} RunResult `time` in seconds; `ending` only for a win
 * @typedef {{ records: Records, isNewBest: boolean, previousBest: number | null }} RecordedRun
 */

/** @type {Readonly<Records>} */
export const EMPTY_RECORDS = Object.freeze({ bestTimes: {}, mostPages: 0, escapes: 0, deaths: 0, endings: [] });

// Each field falls back on its own, like the settings: one bad value does not wipe the rest.
const timeOr = z.catch(z.optional(z.number().check(z.positive())), undefined);
const countOr = z.catch(z.number().check(z.int(), z.nonnegative()), 0);
const RecordsSchema = z.object({
  bestTimes: z.catch(z.object(Object.fromEntries(DIFFICULTY_NAMES.map((name) => [name, timeOr]))), () => ({})),
  mostPages: countOr,
  escapes: countOr,
  deaths: countOr,
  endings: z.catch(z.array(z.enum(ENDING_NAMES)), () => []),
});

/** @param {unknown} saved @returns {Records} */
export function parseRecords(saved) {
  const input = typeof saved === 'object' && saved !== null ? saved : {};
  const parsed = RecordsSchema.parse(input);
  const bestTimes = Object.fromEntries(Object.entries(parsed.bestTimes).filter(([, time]) => time !== undefined));
  return /** @type {Records} */ ({ ...parsed, bestTimes, endings: [...new Set(parsed.endings)] });
}

/**
 * Adds a finished run to the records. Returns new records; the old ones are left as they were.
 * @param {Records} records @param {RunResult} run @returns {RecordedRun}
 */
export function recordRun(records, run) {
  const previousBest = records.bestTimes[run.difficulty] ?? null;
  const isNewBest = run.isWin && (previousBest === null || run.time < previousBest);
  return {
    isNewBest,
    previousBest,
    records: {
      bestTimes: isNewBest ? { ...records.bestTimes, [run.difficulty]: run.time } : { ...records.bestTimes },
      mostPages: Math.max(records.mostPages, run.pagesFound),
      escapes: records.escapes + (run.isWin ? 1 : 0),
      deaths: records.deaths + (run.isWin ? 0 : 1),
      endings: run.ending && !records.endings.includes(run.ending) ? [...records.endings, run.ending] : records.endings,
    },
  };
}

/** @param {number} seconds @returns {string} m:ss */
export function formatTime(seconds) {
  const whole = Math.max(Math.floor(seconds), 0);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * Records kept in storage. A blocked storage still records within the page, it just forgets on reload.
 * @param {Pick<Storage, 'getItem' | 'setItem'> | null} storage
 */
export function createRecordBook(storage) {
  let records = load(storage);
  return {
    get records() {
      return records;
    },
    /** @param {RunResult} run @returns {RecordedRun} */
    record(run) {
      const result = recordRun(records, run);
      records = result.records;
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(records));
      } catch {
        // Storage full or blocked: the record still counts for this page.
      }
      return result;
    },
  };
}

/** @param {Pick<Storage, 'getItem'> | null} storage @returns {Records} */
function load(storage) {
  try {
    return parseRecords(JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return parseRecords({}); // corrupt JSON or storage blocked
  }
}
