import { describe, it, expect } from 'vitest';
import { parseRecords, recordRun, formatTime, createRecordBook, EMPTY_RECORDS } from '../src/core/records.js';
import { deathTip } from '../src/core/tips.js';
import { endingFor, STORY_NOTES, TAPES, PARTIAL_ENDING_PAGES } from '../src/core/story.js';
import { PAGE_COUNT, TAPE_COUNT } from '../src/level/scatter.js';

const win = (time, extra = {}) => ({
  isWin: true,
  time,
  difficulty: 'normal',
  pagesFound: 2,
  ending: 'blind',
  ...extra,
});

/** A Storage stand-in. */
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), data };
}

describe('records', () => {
  it('keeps the fastest escape per difficulty and says when it is beaten', () => {
    const first = recordRun(EMPTY_RECORDS, win(300));
    expect(first.isNewBest).toBe(true);
    const slower = recordRun(first.records, win(400));
    expect(slower.isNewBest).toBe(false);
    expect(slower.records.bestTimes.normal).toBe(300);
    const faster = recordRun(slower.records, win(250));
    expect(faster.isNewBest).toBe(true);
    expect(faster.previousBest).toBe(300);
    expect(faster.records.bestTimes).toEqual({ normal: 250 });
  });

  it('counts deaths without touching the best times, and remembers pages and endings', () => {
    const death = recordRun(EMPTY_RECORDS, { ...win(100), isWin: false, pagesFound: 5, ending: null });
    expect(death.isNewBest).toBe(false);
    expect(death.records).toMatchObject({ deaths: 1, escapes: 0, mostPages: 5, bestTimes: {}, endings: [] });
    const truth = recordRun(death.records, win(500, { pagesFound: 7, ending: 'truth' }));
    expect(truth.records.endings).toEqual(['truth']);
    expect(recordRun(truth.records, win(500, { ending: 'truth' })).records.endings).toEqual(['truth']);
  });

  it('never changes the records it was given', () => {
    const before = JSON.stringify(EMPTY_RECORDS);
    recordRun(EMPTY_RECORDS, win(10));
    expect(JSON.stringify(EMPTY_RECORDS)).toBe(before);
  });

  it('drops only the bad fields of stored records', () => {
    const records = parseRecords({
      bestTimes: { normal: -5, hard: 90 },
      mostPages: 'lots',
      escapes: 2,
      endings: ['truth', 'nope'],
    });
    expect(records.bestTimes).toEqual({ hard: 90 });
    expect(records.mostPages).toBe(0);
    expect(records.escapes).toBe(2);
    expect(parseRecords(null)).toEqual(EMPTY_RECORDS);
  });

  it('saves to storage and reads it back, and survives corrupt or blocked storage', () => {
    const storage = memoryStorage();
    createRecordBook(storage).record(win(123));
    expect(createRecordBook(storage).records.bestTimes.normal).toBe(123);

    expect(createRecordBook(memoryStorage({ 'way-out-records': '{oops' })).records).toEqual(EMPTY_RECORDS);
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const book = createRecordBook(blocked);
    expect(book.record(win(50)).isNewBest).toBe(true); // still counts for this page
  });

  it('formats times as m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65.9)).toBe('1:05');
    expect(formatTime(600)).toBe('10:00');
  });
});

describe('the story', () => {
  it('has a journal page for every page and a transcript for every tape scattered in a run', () => {
    expect(STORY_NOTES).toHaveLength(PAGE_COUNT);
    expect(TAPES).toHaveLength(TAPE_COUNT);
  });

  it('ends by how much of the journal was read', () => {
    expect(endingFor(0, 7)).toBe('blind');
    expect(endingFor(PARTIAL_ENDING_PAGES - 1, 7)).toBe('blind');
    expect(endingFor(PARTIAL_ENDING_PAGES, 7)).toBe('partial');
    expect(endingFor(7, 7)).toBe('truth');
    expect(endingFor(0, 0)).toBe('blind'); // a map without pages has no truth to find
  });
});

describe('deathTip', () => {
  const context = {
    spottedBy: null,
    wasLit: false,
    wasSprinting: false,
    sawHiding: false,
    hadLure: false,
    couldFlash: false,
    struggle: 1,
  };

  it('picks the lesson that fits the death', () => {
    expect(deathTip({ ...context, sawHiding: true })).toMatch(/locker/);
    expect(deathTip({ ...context, spottedBy: 'hearing', wasSprinting: true })).toMatch(/running/);
    expect(deathTip({ ...context, spottedBy: 'sight', wasLit: true })).toMatch(/flashlight/);
    expect(deathTip({ ...context, struggle: 0.2 })).toMatch(/Space/);
    expect(deathTip({ ...context, hadLure: true })).toMatch(/throw/i);
    expect(deathTip({ ...context, couldFlash: true })).toMatch(/Q/);
  });

  it('falls back to a general tip', () => {
    expect(deathTip(context, () => 0)).toMatch(/vent/);
  });
});
