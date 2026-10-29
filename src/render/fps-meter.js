const REPORT_INTERVAL = 0.5; // s between readings
const WARMUP = 5; // s of play ignored first (shaders, loading, the first lamp)
const JUDGE_AFTER = 15; // s of play measured before deciding the game runs slowly
export const SLOW_FPS = 28;

/**
 * Counts frames for the FPS readout, and notices once if a run starts out too slow for the chosen graphics.
 * Only frames that are actually played count (the caller skips paused ones).
 */
export class FpsMeter {
  constructor() {
    this.frames = 0;
    this.elapsed = 0;
    this.playTime = 0;
    this.judgedFrames = 0;
    this.judgedTime = 0;
    this.hasJudged = false;
    /** @type {number | null} frames per second over the last reading */
    this.fps = null;
  }

  /**
   * @param {number} dt the real frame time (s), not clamped
   * @returns {{ fps: number | null, isTooSlow: boolean }} `fps` only when a new reading is due; `isTooSlow` once,
   *   when the first stretch of play averaged under SLOW_FPS
   */
  sample(dt) {
    this.frames++;
    this.elapsed += dt;
    this.playTime += dt;
    if (this.playTime > WARMUP && !this.hasJudged) {
      this.judgedFrames++;
      this.judgedTime += dt;
    }
    let isTooSlow = false;
    if (!this.hasJudged && this.playTime >= WARMUP + JUDGE_AFTER) {
      this.hasJudged = true;
      isTooSlow = this.judgedFrames / this.judgedTime < SLOW_FPS;
    }
    if (this.elapsed < REPORT_INTERVAL) return { fps: null, isTooSlow };
    this.fps = Math.round(this.frames / this.elapsed);
    this.frames = 0;
    this.elapsed = 0;
    return { fps: this.fps, isTooSlow };
  }
}
