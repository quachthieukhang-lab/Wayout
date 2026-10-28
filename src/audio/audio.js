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
});
const IMPACT_EMITTER = Object.freeze({ refDistance: 4, rolloffFactor: 1 }); // a thrown bottle or can landing
const IMPACT_VOICES = 3; // impacts overlap (shards still tinkling as a can bounces): each gets its own emitter
const GLASS_TINKLES = 6;

/** @typedef {{ x: number, z: number }} Point */

export class HorrorAudio {
  /** @param {THREE.Camera} camera carries the listener @param {THREE.Scene} scene holds the sound sources */
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene;
    this.ctx = null;
    this.emitters = /** @type {Record<keyof typeof EMITTERS, THREE.PositionalAudio>} */ ({});
    this.masterVolume = MASTER_VOLUME;
    this.ambienceVolume = 1;
    this.heartTimer = 0;
    this.ambientTimer = 10;
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
    this.master.gain.value = this.masterVolume;
    for (const [name, options] of Object.entries(EMITTERS)) this.emitters[name] = this.createEmitter(options);
    this.impactEmitters = Array.from({ length: IMPACT_VOICES }, () => this.createEmitter(IMPACT_EMITTER));
    this.nextImpact = 0;
    this.ambienceBus = gainNode(this.ctx, this.ambienceVolume);
    this.ambienceBus.connect(this.master);
    this.noiseBuffer = createNoiseBuffer(this.ctx);
    this.distortionCurve = createDistortionCurve(DISTORTION_AMOUNT);
    this.startAmbience();
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

  /** @param {number} dt @param {number} danger 0..1, drives the heartbeat */
  update(dt, danger) {
    if (!this.ctx) return;
    this.heartTimer -= dt;
    if (danger > 0.05 && this.heartTimer <= 0) {
      this.heartbeat(danger);
      this.heartTimer = 1.2 - danger * 0.8;
    }
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.distantSound();
      this.ambientTimer = 12 + Math.random() * 20;
    }
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
