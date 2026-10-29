import { describe, it, expect, vi } from 'vitest';
import { FpsMeter, SLOW_FPS } from '../src/render/fps-meter.js';
import { createScreenLock } from '../src/core/screen-lock.js';
import { startErrorReporting } from '../src/core/error-reporting.js';

/** Runs `seconds` of frames at a steady rate; returns every reading. */
const play = (meter, fps, seconds) => {
  const readings = [];
  for (let t = 0; t < seconds; t += 1 / fps) readings.push(meter.sample(1 / fps));
  return readings;
};

describe('FpsMeter', () => {
  it('reports the frame rate twice a second', () => {
    const meter = new FpsMeter();
    const readings = play(meter, 60, 1.2).filter((reading) => reading.fps !== null);
    expect(readings.length).toBeGreaterThanOrEqual(2);
    expect(readings.at(-1)?.fps).toBe(60);
  });

  it('says once that a slow run should lower its graphics', () => {
    const meter = new FpsMeter();
    const slow = play(meter, SLOW_FPS - 8, 40).filter((reading) => reading.isTooSlow);
    expect(slow).toHaveLength(1);
  });

  it('stays quiet when the game runs smoothly', () => {
    const meter = new FpsMeter();
    expect(play(meter, 60, 40).some((reading) => reading.isTooSlow)).toBe(false);
  });
});

describe('createScreenLock', () => {
  const platform = ({ isFullscreen = false } = {}) => {
    const doc = {
      fullscreenElement: isFullscreen ? {} : null,
      documentElement: {
        requestFullscreen: vi.fn(async () => {
          doc.fullscreenElement = {};
        }),
      },
    };
    const keyboard = { lock: vi.fn(async () => {}), unlock: vi.fn() };
    return { doc, keyboard };
  };

  it('goes full screen on start, then locks the keyboard so Ctrl+W reaches the game', async () => {
    const { doc, keyboard } = platform();
    const lock = createScreenLock({ doc: /** @type {any} */ (doc), keyboard });
    lock.enter();
    await vi.waitFor(() => expect(keyboard.lock).toHaveBeenCalled());
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledOnce();
    expect(lock.isKeyboardLocked).toBe(true);
  });

  it('gives the keys back in the menus and takes them again on resume', () => {
    const { doc, keyboard } = platform({ isFullscreen: true });
    const lock = createScreenLock({ doc: /** @type {any} */ (doc), keyboard });
    lock.setPlaying(true);
    lock.setPlaying(false);
    expect(keyboard.unlock).toHaveBeenCalledOnce();
    expect(lock.isKeyboardLocked).toBe(false);
    lock.setPlaying(true);
    expect(keyboard.lock).toHaveBeenCalledTimes(2);
  });

  it('does nothing when switched off in Settings, or without Keyboard Lock (Firefox, Safari)', async () => {
    const off = platform();
    const lock = createScreenLock({ doc: /** @type {any} */ (off.doc), keyboard: off.keyboard });
    lock.setEnabled(false);
    lock.enter();
    expect(off.doc.documentElement.requestFullscreen).not.toHaveBeenCalled();

    const firefox = platform();
    const plain = createScreenLock({ doc: /** @type {any} */ (firefox.doc), keyboard: null });
    plain.enter();
    await vi.waitFor(() => expect(firefox.doc.fullscreenElement).not.toBeNull());
    expect(plain.isKeyboardLocked).toBe(false);
  });
});

describe('startErrorReporting', () => {
  it('stays off without a DSN, when switched off, and outside production builds', async () => {
    const base = {
      dsn: 'https://key@example.ingest.sentry.io/1',
      release: '1.0.0',
      isEnabled: true,
      isProduction: true,
    };
    expect(await startErrorReporting({ ...base, dsn: undefined })).toBe(false);
    expect(await startErrorReporting({ ...base, isEnabled: false })).toBe(false);
    expect(await startErrorReporting({ ...base, isProduction: false })).toBe(false);
  });
});
