import * as THREE from 'three';

// All sounds are synthesized with the Web Audio API, so the game ships with no audio files.
// Sounds with a place in the world play through three's PositionalAudio: HRTF panning (front/back too) and distance
// fall-off follow the camera's AudioListener every frame.
const MASTER_VOLUME = 0.7;
const MIN_ATTACK = 0.012; // shorter fades click audibly
const NOISE_SECONDS = 2;
const SILENCE = 0.0001; // exponential ramps cannot reach 0
const DISTORTION_AMOUNT = 40;
const SOURCE_HEIGHT = 1.2; // world sounds come from about chest height
const DISTANT_RADIUS = 15;
// Inverse distance model: full volume up to refDistance, then refDistance / (refDistance + rolloff * (d - refDistance)).
const EMITTERS = Object.freeze({
  monster: { refDistance: 3, rolloffFactor: 1.5 },
  beacon: { refDistance: 6, rolloffFactor: 1 }, // key sense chime, a few cells ahead along the route
  distant: { refDistance: DISTANT_RADIUS, rolloffFactor: 1 },
  phantom: { refDistance: 3, rolloffFactor: 1.2 }, // a sound right behind you that nothing made
  slam: { refDistance: 6, rolloffFactor: 1 }, // a door banging shut somewhere
});
const IMPACT_EMITTER = Object.freeze({ refDistance: 4, rolloffFactor: 1 }); // a thrown bottle or can landing
const RADIO_TUNE = Object.freeze([523, 659, 784, 659, 587, 698, 880, 698]); // a tinny old waltz
const RADIO_NOTE = 0.35; // s per note
const IMPACT_VOICES = 3; // impacts overlap (shards still tinkling as a can bounces): each gets its own emitter
const GLASS_TINKLES = 6;
// Chase music: a dissonant low drone pulsing on the beat, a shivering high cluster, and drums.
const CHASE_VOLUME = 0.22;
const CHASE_FADE_IN = 0.6; // s
const CHASE_FADE_OUT = 3;
const CHASE_BEAT = 0.4; // s between drum hits (150 bpm)
const CHASE_ACCENT_EVERY = 4;
// Echo of the space the player stands in: a room, a long hall, or something tight (a vent, a locker).
// Generated impulse responses: decaying noise, so no audio files. `wet` = how much of everything is sent to it.
const SPACES = Object.freeze({
  room: Object.freeze({ seconds: 1.1, decay: 3, wet: 0.22 }),
  hall: Object.freeze({ seconds: 2.6, decay: 2.2, wet: 0.35 }),
  tight: Object.freeze({ seconds: 0.35, decay: 4, wet: 0.3 }),
});
const SPACE_FADE = 0.4; // s time constant of the crossfade between spaces
// Breathing: slow and nearly silent at rest, fast and loud when spent; held in when hiding.
const BREATH_PERIOD = Object.freeze({ calm: 4, spent: 1.1 }); // s per breath
const BREATH_VOLUME = Object.freeze({ calm: 0.012, spent: 0.09 });
const HIDDEN_BREATH = 0.5;
const LOW_HEALTH = 0.4; // below this the heart pounds even when nothing is near
const FLARE_HISS = 0.05;
const TAPE_SYLLABLE = Object.freeze({ min: 0.14, max: 0.32 }); // s per murmured syllable

/** @typedef {{ x: number, z: number }} Point */

export class HorrorAudio {
  /** @param {THREE.Camera} camera carries the listener @param {THREE.Scene} scene holds the sound sources */
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene;
    this.ctx = null;
    this.emitters = /** @type {Record<keyof typeof EMITTERS, THREE.PositionalAudio>} */ ({});
    /** @type {THREE.PositionalAudio | null} created the first time a radio plays */
    this.radioEmitter = null;
    this.masterVolume = MASTER_VOLUME;
    this.ambienceVolume = 1;
    this.heartTimer = 0;
    this.breathTimer = 0;
    this.ambientTimer = 10;
    /** @type {keyof typeof SPACES | null} */
    this.space = null;
    /** @type {{ emitter: THREE.PositionalAudio, gain: GainNode } | null} created the first time a flare burns */
    this.flareHiss = null;
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    if (!window.AudioContext && !('webkitAudioContext' in window)) return; // no Web Audio: the game stays playable, just silent

    this.listener = new THREE.AudioListener();
    this.camera.add(this.listener);
    this.ctx = this.listener.context;
    this.ctx.resume();
    // Compressor evens out quiet footsteps vs. loud screams and prevents clipping.
    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 3;
    this.listener.setFilter(compressor);
    this.master = this.listener.getInput();
    this.reverbs = this.createReverbs(compressor);
    this.master.gain.value = this.masterVolume;
    for (const [name, options] of Object.entries(EMITTERS)) this.emitters[name] = this.createEmitter(options);
    this.impactEmitters = Array.from({ length: IMPACT_VOICES }, () => this.createEmitter(IMPACT_EMITTER));
    this.nextImpact = 0;
    this.ambienceBus = gainNode(this.ctx, this.ambienceVolume);
    this.ambienceBus.connect(this.master);
    this.noiseBuffer = createNoiseBuffer(this.ctx);
    this.distortionCurve = createDistortionCurve(DISTORTION_AMOUNT);
    this.startAmbience();
    this.startChaseMusic();
  }

  /** @param {number} master 0..1 overall volume @param {number} ambience 0..1 background drone and wind */
  setVolumes(master, ambience) {
    this.masterVolume = master;
    this.ambienceVolume = ambience;
    if (!this.ctx) return; // applied in start()
    this.master.gain.value = master;
    this.ambienceBus.gain.value = ambience;
  }

  /** @param {boolean} isPaused */
  setPaused(isPaused) {
    if (!this.ctx) return;
    if (isPaused) this.ctx.suspend();
    else this.ctx.resume();
  }

  /**
   * @param {number} dt @param {number} danger 0..1, drives the heartbeat
   * @param {{ exertion?: number, health?: number, isHidden?: boolean }} [vitals] exertion 0..1 (spent = 1) drives the
   *   breathing; health 0..1 below LOW_HEALTH makes the heart pound; hidden = holding your breath
   */
  update(dt, danger, { exertion = 0, health = 1, isHidden = false } = {}) {
    if (!this.ctx) return;
    const pounding = Math.max(danger, health < LOW_HEALTH ? (1 - health / LOW_HEALTH) * 0.6 : 0);
    this.heartTimer -= dt;
    if (pounding > 0.05 && this.heartTimer <= 0) {
      this.heartbeat(pounding);
      this.heartTimer = 1.2 - pounding * 0.8;
    }
    this.breathTimer -= dt;
    if (this.breathTimer <= 0) {
      const effort = Math.min(Math.max(exertion, danger * 0.6), 1);
      const period = THREE.MathUtils.lerp(BREATH_PERIOD.calm, BREATH_PERIOD.spent, effort);
      const volume = THREE.MathUtils.lerp(BREATH_VOLUME.calm, BREATH_VOLUME.spent, effort);
      this.breathe(period, isHidden ? volume * HIDDEN_BREATH : volume);
      this.breathTimer = period;
    }
    if (this.isChasing) this.updateChaseDrums(dt);
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.distantSound();
      this.ambientTimer = 12 + Math.random() * 20;
    }
  }

  /** Fades the chase music in while it hunts the player, and out once it gives up. @param {boolean} isChasing */
  setChase(isChasing) {
    if (!this.ctx || isChasing === this.isChasing) return;
    this.isChasing = isChasing;
    this.chaseBeatTimer = 0;
    const gain = this.chaseBus.gain;
    const now = this.ctx.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(isChasing ? CHASE_VOLUME : 0, now + (isChasing ? CHASE_FADE_IN : CHASE_FADE_OUT));
  }

  updateChaseDrums(dt) {
    this.chaseBeatTimer -= dt;
    if (this.chaseBeatTimer > 0) return;
    this.chaseBeatTimer += CHASE_BEAT;
    this.chaseBeat = (this.chaseBeat + 1) % CHASE_ACCENT_EVERY;
    const isAccent = this.chaseBeat === 0;
    this.tone({ type: 'triangle', freq: 95, freqEnd: 45, duration: 0.28, volume: isAccent ? 0.45 : 0.28 });
    if (isAccent) this.tone({ type: 'sawtooth', freq: 233, duration: 0.18, volume: 0.07, filterFreq: 1400 });
  }

  // Thumps use triangle waves around 80-130 Hz: pure sub-bass sines are inaudible on laptop speakers.
  footstep(volume) {
    this.noise({ duration: 0.09, volume: volume * 1.2, freq: 900, Q: 0.8 });
    this.tone({ type: 'triangle', freq: 120, freqEnd: 80, duration: 0.08, volume: volume * 0.6 });
  }

  /** @param {number} volume 0..1 before distance fall-off @param {Point} position the monster */
  monsterStep(volume, position) {
    this.place('monster', position);
    this.tone({ type: 'triangle', freq: 100, freqEnd: 50, duration: 0.3, volume, source: 'monster' });
    this.noise({ duration: 0.25, volume: volume * 0.8, type: 'lowpass', freq: 700, source: 'monster' });
  }

  heartbeat(danger) {
    const volume = 0.3 + danger * 0.5;
    this.tone({ type: 'triangle', freq: 95, freqEnd: 55, duration: 0.18, volume });
    this.tone({ type: 'triangle', freq: 85, freqEnd: 50, duration: 0.18, volume: volume * 0.7, delay: 0.2 });
  }

  /** One breath: an airy inhale, then a lower exhale. @param {number} period s @param {number} volume */
  breathe(period, volume) {
    this.noise({ duration: period * 0.35, volume, freq: 1300, Q: 0.6, attack: period * 0.15 });
    this.noise({ duration: period * 0.4, volume: volume * 0.8, freq: 650, Q: 0.7, attack: 0.05, delay: period * 0.42 });
  }

  /** Crossfades the echo to fit where the player stands. @param {keyof typeof SPACES} space */
  setSpace(space) {
    if (!this.ctx || space === this.space) return;
    this.space = space;
    const now = this.ctx.currentTime;
    for (const [name, wet] of Object.entries(this.reverbs)) {
      wet.gain.setTargetAtTime(name === space ? SPACES[name].wet : 0, now, SPACE_FADE);
    }
  }

  /** A convolver per space, all fed from the master bus, each with its own (silent until chosen) return. */
  createReverbs(output) {
    /** @type {Record<string, GainNode>} */
    const returns = {};
    for (const [name, { seconds, decay }] of Object.entries(SPACES)) {
      const convolver = this.ctx.createConvolver();
      convolver.buffer = createImpulse(this.ctx, seconds, decay);
      const wet = gainNode(this.ctx, 0);
      this.master.connect(convolver).connect(wet).connect(output);
      returns[name] = wet;
    }
    return returns;
  }

  /** A tape recorder: hiss and a muffled voice, syllable after syllable. @param {number} duration s */
  tape(duration) {
    if (!this.ctx) return;
    this.noise({ duration, volume: 0.04, type: 'highpass', freq: 4000, attack: 0.1 });
    for (let t = 0.3; t < duration - 0.3;) {
      const length = TAPE_SYLLABLE.min + Math.random() * (TAPE_SYLLABLE.max - TAPE_SYLLABLE.min);
      const pitch = 110 + Math.random() * 60;
      this.tone({
        type: 'sawtooth',
        freq: pitch,
        freqEnd: pitch * (0.85 + Math.random() * 0.3),
        duration: length,
        volume: 0.06,
        attack: 0.03,
        delay: t,
        filterFreq: 500 + Math.random() * 1000, // the moving formant makes it sound like words
      });
      t += length + (Math.random() < 0.2 ? 0.35 : 0.04); // the odd pause between words
    }
  }

  /** The striker scraping, then the flare catching. */
  flareIgnite() {
    this.noise({ duration: 0.15, volume: 0.2, type: 'highpass', freq: 2500 });
    this.noise({ duration: 0.6, volume: 0.15, freq: 1800, Q: 0.5, delay: 0.12, attack: 0.05 });
  }

  /**
   * The hiss of a burning flare, from where it lies. Call every frame.
   * @param {{ x: number, y?: number, z: number } | null} position null = none burning
   */
  flareBurning(position) {
    if (!this.ctx || (!position && !this.flareHiss)) return;
    if (!this.flareHiss) {
      const emitter = this.createEmitter(IMPACT_EMITTER);
      const hiss = this.ctx.createBufferSource();
      hiss.buffer = this.noiseBuffer;
      hiss.loop = true;
      const gain = gainNode(this.ctx, 0);
      hiss
        .connect(this.filter('bandpass', 3200, 0.8))
        .connect(gain)
        .connect(emitter.getOutput());
      hiss.start();
      this.flareHiss = { emitter, gain };
    }
    const { emitter, gain } = this.flareHiss;
    gain.gain.setTargetAtTime(position ? FLARE_HISS : 0, this.ctx.currentTime, 0.2);
    if (!position) return;
    emitter.position.set(position.x, position.y ?? SOURCE_HEIGHT, position.z);
    emitter.updateMatrixWorld();
  }

  /** Cloth tearing, then wrapped tight. */
  bandage() {
    this.noise({ duration: 0.35, volume: 0.12, freq: 2200, Q: 0.6, attack: 0.02 });
    this.noise({ duration: 0.25, volume: 0.08, freq: 900, Q: 0.8, delay: 0.4 });
  }

  /** Every lamp dies at once: the mains hum winds down, then a heavy clunk. */
  powerDown() {
    this.tone({ type: 'sawtooth', freq: 120, freqEnd: 30, duration: 1.6, volume: 0.12, filterFreq: 400 });
    this.tone({ type: 'triangle', freq: 90, freqEnd: 40, duration: 0.4, volume: 0.35, delay: 1.5 });
  }

  /** The power comes back: a rising hum and the lamps buzzing on. */
  powerUp() {
    this.tone({ type: 'sawtooth', freq: 40, freqEnd: 120, duration: 1.2, volume: 0.08, filterFreq: 400 });
    this.noise({ duration: 0.3, volume: 0.06, freq: 3000, Q: 4, delay: 1 });
  }

  /** A door banging shut somewhere. @param {Point} position */
  doorSlam(position) {
    if (!this.ctx) return;
    this.place('slam', position);
    this.tone({ type: 'triangle', freq: 110, freqEnd: 45, duration: 0.5, volume: 0.6, source: 'slam' });
    this.noise({ duration: 0.3, volume: 0.45, type: 'lowpass', freq: 900, source: 'slam' });
    this.noise({ duration: 0.15, volume: 0.2, freq: 2400, Q: 3, delay: 0.05, source: 'slam' });
  }

  /** Right behind the player: slow footsteps, a knock, or a whisper. Nothing is there. @param {Point} position */
  phantom(position) {
    if (!this.ctx) return;
    this.place('phantom', position);
    const source = 'phantom';
    const roll = Math.random();
    if (roll < 0.4) {
      [0, 0.7, 1.4].forEach((delay) =>
        this.tone({ type: 'triangle', freq: 100, freqEnd: 50, duration: 0.3, volume: 0.25, delay, source }),
      );
    } else if (roll < 0.7) {
      [0, 0.25].forEach((delay) => this.noise({ duration: 0.08, volume: 0.3, freq: 500, Q: 2, delay, source }));
    } else {
      this.noise({ duration: 1.6, volume: 0.06, freq: 2800, Q: 2.5, attack: 0.4, source });
      this.noise({ duration: 1.2, volume: 0.04, freq: 1500, Q: 3, attack: 0.3, delay: 0.3, source });
    }
  }

  pickup() {
    this.tone({ freq: 523, duration: 0.35, volume: 0.12 });
    this.tone({ freq: 622, duration: 0.5, volume: 0.1, delay: 0.12 });
  }

  flash() {
    this.tone({ freq: 1800, freqEnd: 500, duration: 0.3, volume: 0.12 });
    this.noise({ duration: 0.25, volume: 0.2, type: 'highpass', freq: 2500 });
  }

  click() {
    this.noise({ duration: 0.03, volume: 0.15, type: 'highpass', freq: 3000 });
  }

  /** Key sense: a soft, eerie bell from the way to the key. @param {Point | null} position null = no route, plays centred */
  chime(position) {
    const source = position ? 'beacon' : null;
    if (position) this.place(source, position);
    this.tone({ freq: 740, duration: 1.6, volume: 0.1, source });
    this.tone({ freq: 1110, duration: 1.2, volume: 0.06, delay: 0.08, source });
  }

  /** A quick swish as something leaves the hand. */
  whoosh() {
    this.noise({ duration: 0.2, volume: 0.06, freq: 700, Q: 0.7, attack: 0.06 });
  }

  /** A glass bottle smashing: a sharp crash, then a scatter of tinkling shards. @param {Point} position */
  shatter(position) {
    if (!this.ctx) return;
    const source = this.impactEmitterAt(position);
    this.noise({ duration: 0.35, volume: 0.5, type: 'highpass', freq: 2800, source });
    this.noise({ duration: 0.12, volume: 0.35, freq: 1400, Q: 2, source });
    for (let i = 0; i < GLASS_TINKLES; i++) {
      const delay = 0.04 + Math.random() * 0.35;
      this.tone({
        freq: 2500 + Math.random() * 3000,
        duration: 0.12 + Math.random() * 0.2,
        volume: 0.05,
        delay,
        source,
      });
    }
  }

  /** A tin can hitting something; softer bounces ring quieter. @param {number} volume 0..1 @param {Point} position */
  clank(volume, position) {
    if (!this.ctx) return;
    const source = this.impactEmitterAt(position);
    this.noise({ duration: 0.08, volume: 0.4 * volume, freq: 2200, Q: 4, source });
    this.tone({ type: 'triangle', freq: 1250, freqEnd: 1150, duration: 0.25, volume: 0.12 * volume, source });
    this.tone({ freq: 1870, duration: 0.18, volume: 0.06 * volume, source });
  }

  /**
   * A step on glass or loose boards. @param {'glass' | 'boards'} kind @param {number} volume 0..1
   * @param {Point} [position] where it happened; omitted = under the player's own feet
   */
  floorNoise(kind, volume, position) {
    if (!this.ctx) return;
    const source = position ? this.impactEmitterAt(position) : null;
    if (kind === 'boards') {
      this.tone({
        type: 'sawtooth',
        freq: 190,
        freqEnd: 120 + Math.random() * 90,
        duration: 0.4,
        volume: 0.07 * volume,
        attack: 0.05,
        filterFreq: 900,
        source,
      });
      return;
    }
    this.noise({ duration: 0.12, volume: 0.35 * volume, type: 'highpass', freq: 3200, source });
    for (let i = 0; i < 3; i++) {
      this.tone({
        freq: 3000 + Math.random() * 2500,
        duration: 0.06 + Math.random() * 0.08,
        volume: 0.04 * volume,
        delay: Math.random() * 0.08,
        source,
      });
    }
  }

  /** A heavy door swinging on rusty hinges. @param {Point} position @param {number} [volume] 0..1 */
  doorCreak(position, volume = 1) {
    if (!this.ctx) return;
    const source = this.impactEmitterAt(position);
    this.tone({
      type: 'sawtooth',
      freq: 260,
      freqEnd: 180,
      duration: 0.9,
      volume: 0.12 * volume,
      attack: 0.08,
      filterFreq: 1200,
      source,
    });
    this.noise({ duration: 0.25, volume: 0.15 * volume, freq: 300, delay: 0.75, source });
  }

  /** An old radio: static under a tinny tune, from where it stands. @param {Point} position @param {number} duration s */
  radio(position, duration) {
    if (!this.ctx) return;
    this.radioEmitter ??= this.createEmitter(IMPACT_EMITTER);
    this.radioEmitter.position.set(position.x, SOURCE_HEIGHT, position.z);
    this.radioEmitter.updateMatrixWorld();
    const source = this.radioEmitter;
    this.noise({ duration, volume: 0.1, freq: 1800, Q: 0.7, attack: 0.3, source });
    for (let t = 0, i = 0; t < duration - RADIO_NOTE; t += RADIO_NOTE, i++) {
      const freq = RADIO_TUNE[i % RADIO_TUNE.length];
      this.tone({ type: 'square', freq, duration: RADIO_NOTE * 0.9, volume: 0.05, delay: t, filterFreq: 2400, source });
    }
  }

  /** Metal locker door: a short rattle and a low clunk. */
  lockerDoor() {
    this.noise({ duration: 0.22, volume: 0.1, type: 'bandpass', freq: 1800, Q: 6 });
    this.tone({ type: 'triangle', freq: 190, freqEnd: 120, duration: 0.25, volume: 0.06, delay: 0.04 });
  }

  /** @param {Point} [position] the monster; omitted = right in your face */
  growl(position) {
    const source = position ? 'monster' : null;
    if (position) this.place(source, position);
    this.tone({
      type: 'sawtooth',
      freq: 140,
      freqEnd: 70,
      duration: 1.4,
      volume: 0.5,
      attack: 0.1,
      filterFreq: 700,
      source,
    });
    this.noise({ duration: 1.2, volume: 0.3, freq: 300, attack: 0.1, source });
  }

  scream() {
    this.tone({ type: 'sawtooth', freq: 600, freqEnd: 1800, duration: 1.3, volume: 0.6, isDistorted: true });
    this.tone({ type: 'square', freq: 900, freqEnd: 2400, duration: 1.1, volume: 0.3, isDistorted: true });
    this.noise({ duration: 1.4, volume: 0.7, freq: 2000, Q: 0.5 });
  }

  doorOpen() {
    this.tone({ type: 'sawtooth', freq: 80, freqEnd: 60, duration: 2.5, volume: 0.2, attack: 0.2, filterFreq: 300 });
    this.noise({ duration: 2, volume: 0.15, freq: 1200, Q: 8, attack: 0.3 });
  }

  /** A random far-off creak, knock or whisper. */
  distantSound() {
    const angle = Math.random() * Math.PI * 2;
    const around = this.camera.getWorldPosition(new THREE.Vector3());
    this.place('distant', {
      x: around.x + Math.cos(angle) * DISTANT_RADIUS,
      z: around.z + Math.sin(angle) * DISTANT_RADIUS,
    });
    const source = 'distant';
    const roll = Math.random();
    if (roll < 0.4) {
      this.tone({
        type: 'sawtooth',
        freq: 160,
        freqEnd: 110,
        duration: 2,
        volume: 0.08,
        attack: 0.4,
        filterFreq: 600,
        source,
      });
    } else if (roll < 0.75) {
      [0, 0.35, 0.7].forEach((delay) =>
        this.tone({ type: 'triangle', freq: 120, freqEnd: 70, duration: 0.25, volume: 0.2, delay, source }),
      );
    } else {
      this.noise({ duration: 1.5, volume: 0.05, freq: 2500, Q: 3, attack: 0.5, source });
    }
  }

  /** @param {{ refDistance: number, rolloffFactor: number }} options */
  createEmitter({ refDistance, rolloffFactor }) {
    const emitter = new THREE.PositionalAudio(this.listener);
    // Fed by our own nodes; otherwise three only tracks its position while play()ing. (Typed read-only, set by setNodeSource.)
    /** @type {{ hasPlaybackControl: boolean }} */ (/** @type {unknown} */ (emitter)).hasPlaybackControl = false;
    emitter.setDistanceModel('inverse');
    emitter.setRefDistance(refDistance);
    emitter.setRolloffFactor(rolloffFactor);
    this.scene.add(emitter);
    return emitter;
  }

  /** The next emitter of the impact pool, moved to the impact. @param {Point} position */
  impactEmitterAt(position) {
    const emitter = this.impactEmitters[this.nextImpact];
    this.nextImpact = (this.nextImpact + 1) % IMPACT_VOICES;
    emitter.position.set(position.x, SOURCE_HEIGHT, position.z);
    emitter.updateMatrixWorld();
    return emitter;
  }

  /** Moves a sound source; three keeps its Web Audio panner in sync. @param {keyof typeof EMITTERS} name @param {Point} position */
  place(name, position) {
    const emitter = this.emitters[name];
    emitter.position.set(position.x, SOURCE_HEIGHT, position.z);
    emitter.updateMatrixWorld();
  }

  startAmbience() {
    const { ctx } = this;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 300;
    [55, 55.4].forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle'; // sawtooth buzzed like a bad cable
      osc.frequency.value = freq;
      osc.connect(droneFilter);
      osc.start();
    });
    droneFilter.connect(gainNode(ctx, 0.02)).connect(this.ambienceBus);

    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuffer;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.8;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    lfo.connect(gainNode(ctx, 220)).connect(windFilter.frequency);
    lfo.start();
    wind.connect(windFilter).connect(gainNode(ctx, 0.012)).connect(this.ambienceBus);
    wind.start();
  }

  /** Always running, silent until setChase(true) raises its bus. */
  startChaseMusic() {
    const { ctx } = this;
    this.isChasing = false;
    this.chaseBeat = 0;
    this.chaseBeatTimer = 0;
    this.chaseBus = gainNode(ctx, 0);
    this.chaseBus.connect(this.master);

    const drone = ctx.createBiquadFilter();
    drone.type = 'lowpass';
    drone.frequency.value = 450;
    [55, 58.27].forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq; // a semitone apart: it grinds
      osc.connect(drone);
      osc.start();
    });
    const pulse = gainNode(ctx, 0.5);
    const beat = ctx.createOscillator();
    beat.type = 'square';
    beat.frequency.value = 1 / CHASE_BEAT;
    beat.connect(gainNode(ctx, 0.5)).connect(pulse.gain); // the drone throbs between 0 and 1 on the beat
    beat.start();
    drone.connect(pulse).connect(this.chaseBus);

    [880, 932.33].forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const vibrato = ctx.createOscillator();
      vibrato.frequency.value = 6;
      vibrato.connect(gainNode(ctx, 9)).connect(osc.frequency);
      vibrato.start();
      osc.connect(gainNode(ctx, 0.05)).connect(this.chaseBus);
      osc.start();
    });
  }

  /** `source` names an emitter for a sound placed in the world; null plays it straight to the ears. */
  tone({
    type = 'sine',
    freq,
    freqEnd = freq,
    duration,
    volume,
    attack = 0.01,
    delay = 0,
    source = null,
    filterFreq = 0,
    isDistorted = false,
  }) {
    if (!this.ctx) return;
    const start = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = /** @type {OscillatorType} */ (type);
    osc.frequency.setValueAtTime(freq, start);
    osc.frequency.exponentialRampToValueAtTime(freqEnd, start + duration);

    /** @type {AudioNode} */
    let node = osc;
    if (filterFreq) node = node.connect(this.filter('lowpass', filterFreq));
    if (isDistorted) {
      const shaper = this.ctx.createWaveShaper();
      shaper.curve = this.distortionCurve;
      node = node.connect(shaper);
    }
    this.envelope(node, start, attack, duration, volume, source);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  noise({ duration, volume, type = 'bandpass', freq = 800, Q = 1, attack = 0.005, delay = 0, source = null }) {
    if (!this.ctx) return;
    const start = this.ctx.currentTime + delay;
    const buffer = this.ctx.createBufferSource();
    buffer.buffer = this.noiseBuffer;
    buffer.loop = true;
    this.envelope(buffer.connect(this.filter(type, freq, Q)), start, attack, duration, volume, source);
    buffer.start(start, Math.random() * NOISE_SECONDS);
    buffer.stop(start + duration + 0.05);
  }

  filter(type, frequency, Q = 1) {
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = Q;
    return filter;
  }

  envelope(node, start, attack, duration, volume, source) {
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(SILENCE, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(volume, SILENCE), start + Math.max(attack, MIN_ATTACK));
    gain.gain.exponentialRampToValueAtTime(SILENCE, start + duration);
    const emitter = typeof source === 'string' ? this.emitters[source] : source;
    node.connect(gain).connect(emitter ? emitter.getOutput() : this.master);
  }
}

function gainNode(ctx, value) {
  const gain = ctx.createGain();
  gain.gain.value = value;
  return gain;
}

function createNoiseBuffer(ctx) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * NOISE_SECONDS, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** Stereo room echo: noise dying away. @param {BaseAudioContext} ctx @param {number} seconds @param {number} decay */
function createImpulse(ctx, seconds, decay) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
  }
  return buffer;
}

function createDistortionCurve(amount) {
  const samples = 1024;
  const curve = new Float32Array(samples);
  const degree = Math.PI / 180;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + amount) * x * 20 * degree) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}
