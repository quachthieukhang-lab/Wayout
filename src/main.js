import * as THREE from 'three';
import { LEVEL_MAP, ROOMS, MARROW_OFFICE, parseLevel, cellToWorld, isWalkable } from './level/level.js';
import { blockPassages } from './level/blockers.js';
import { createRecordBook, formatTime } from './core/records.js';
import { createScreenLock } from './core/screen-lock.js';
import { startErrorReporting } from './core/error-reporting.js';
import { FpsMeter } from './render/fps-meter.js';
import { createWorld } from './world/world.js';
import { Input } from './core/input.js';
import { Player } from './player/player.js';
import { ViewModel } from './player/viewmodel.js';
import { Flashlight } from './player/flashlight.js';
import { Monster } from './monster/monster.js';
import { loadMonsterModel, createStalkerModel } from './monster/monster-model.js';
import { loadHandModel } from './player/hand-model.js';
import { createPickups } from './items/pickups.js';
import { HorrorAudio } from './audio/audio.js';
import { createHud } from './ui/hud.js';
import { Game } from './core/game.js';
import { bindSettingsForm, bindSettingsMenu, loadSettings } from './core/settings.js';
import { DIFFICULTIES } from './core/difficulty.js';
import { scatterItems, PAGE_COUNT } from './level/scatter.js';
import { ENDINGS } from './core/story.js';
import { TUTORIAL_MAP, TUTORIAL_ROOMS } from './level/tutorial-map.js';
import { Tutorial } from './core/tutorial.js';
import { createGraphics } from './render/graphics.js';
import { createDust } from './world/dust.js';
import { version } from '../package.json';

const MAX_DT = 0.05;
// Chromium sometimes reports a huge movementX/Y right after the pointer is captured; real moves are far smaller.
const MAX_MOUSE_STEP = 300; // px in one event
// sessionStorage: how the next page load starts. 'restart' = a new run with a compact title screen,
// 'tutorial' = the tutorial. Absent = the full title screen.
const LAUNCH_KEY = 'way-out-launch';
const SLOW_TIP = 'The game is running slowly. Try Settings → Display → Graphics: Low.';
const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // tone mapping is done by the effect chain in graphics.js
document.getElementById('app').appendChild(renderer.domElement);

const savedSettings = loadSettings();
startErrorReporting({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  release: version,
  isEnabled: savedSettings.isErrorReportingOn,
  isProduction: import.meta.env.PROD,
});

const launch = takeLaunch();
const isTutorial = launch === 'tutorial';
const rooms = isTutorial ? TUTORIAL_ROOMS : ROOMS;
// Every run chains a few doors, caves in a few hall cells, and scatters the keys, pages, tapes and supplies anew;
// the tutorial is always laid out the same.
const level = isTutorial
  ? parseLevel(TUTORIAL_MAP)
  : scatterItems(parseLevel(blockPassages(LEVEL_MAP, ROOMS)), Math.random, {
      tapeRoom: ROOMS.find((room) => room.name === MARROW_OFFICE),
    });
const world = createWorld(level, rooms);
const { scene } = world;

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 80);
scene.add(camera); // camera must be in the scene so the arms (its children) render

const input = new Input();
const spawn = cellToWorld(level.spawn);
const player = new Player(camera, world.colliders, input, new THREE.Vector3(spawn.x, 0, spawn.z));
player.yaw = facingOpenCorridor(level.spawn);

const viewModel = new ViewModel(camera);
const flashlight = new Flashlight();
flashlight.attachTo(camera);
if (isTutorial) flashlight.toggle(); // starts off: a tutorial step teaches F
const handLoaded = loadHandModel()
  .then((model) => model && viewModel.setHandModel(model))
  .catch((error) => console.warn('Could not load the hand model, keeping the box hands.', error));

const monster = new Monster(level);
monster.setModel(createStalkerModel());
scene.add(monster.object);
const monsterLoaded = loadMonsterModel()
  .then((model) => model && monster.setModel(model))
  .catch((error) => console.warn('Could not load the monster model, using the fallback stalker.', error));

const graphics = createGraphics(renderer, scene, camera, { flashlight: flashlight.light, eye: monster.eyeLight });
const dust = createDust(scene, flashlight.light);
let devTools = null; // FPS meter + tuning panel, `npm run dev` only
if (import.meta.env.DEV) {
  import('./render/dev-tools.js')
    .then(({ createDevTools }) => {
      devTools = createDevTools({ graphics, flashlight, scene });
    })
    .catch((error) => console.warn('Dev tools failed to load.', error));
}
const pickups = createPickups(scene, level);
const audio = new HorrorAudio(camera, scene);
const hud = createHud();
document.querySelectorAll('[data-version]').forEach((label) => {
  label.textContent = `v${version}`;
});
const tutorial = isTutorial ? new Tutorial() : null;
const recordBook = createRecordBook(storage());
hud.setRecords(describeRecords(recordBook.records));
hud.initMap(level, rooms);
const screenLock = createScreenLock();
const fpsMeter = new FpsMeter();
const fpsLabel = document.getElementById('fps');
let settings = savedSettings;
const game = new Game({
  rooms,
  recordBook,
  level,
  camera,
  input,
  player,
  viewModel,
  flashlight,
  monster,
  pickups,
  world,
  audio,
  hud,
  tutorial,
});
// Dev builds only: lets a DevTools session inspect and drive a run (e.g. the headless movement check).
if (import.meta.env.DEV) /** @type {any} */ (window).wayOut = { game, player, input };

// The start screen waits for both models, then compiles every shader, so nothing hitches the first time it appears.
const LOADING_STEPS = 3; // hand, monster, shaders
let loadedSteps = 0;
let isReady = false;
const stepDone = () => hud.setLoading(++loadedSteps / LOADING_STEPS);
hud.setLoading(0);
handLoaded.then(stepDone);
monsterLoaded.then(stepDone);
Promise.all([handLoaded, monsterLoaded])
  .then(() => graphics.precompile())
  .catch((error) => console.warn('Shader precompile failed; shaders will compile on first use.', error))
  .finally(() => {
    isReady = true;
    hud.setLoading(null);
  });

const settingsMenu = bindSettingsMenu(document.getElementById('settings'));
const difficultySelect = /** @type {HTMLSelectElement} */ (document.querySelector('[data-setting="difficulty"]'));
bindSettingsForm(document.getElementById('settings'), (changed) => {
  settings = changed;
  game.setDifficulty(DIFFICULTIES[settings.difficulty]);
  audio.setVolumes(settings.masterVolume, settings.ambienceVolume);
  player.mouseSensitivity = settings.mouseSensitivity;
  player.isYInverted = settings.isYInverted;
  player.baseFov = settings.fov;
  renderer.toneMappingExposure = settings.brightness;
  graphics.setQuality(settings.graphics);
  screenLock.setEnabled(settings.isFullscreen);
  fpsLabel.classList.toggle('hidden', !settings.showFps);
});

hud.setQuickStart(launch !== null);
hud.setTutorial(isTutorial);
hud.overlay.addEventListener('click', (event) => {
  const target = /** @type {Element} */ (event.target);
  if (!isReady || target.closest('.title-side')) return; // switching tabs or moving a slider must not start the game
  if (target.closest('#tutorial-button')) {
    reload('tutorial');
    return;
  }
  const choice = /** @type {HTMLElement | null} */ (target.closest('[data-difficulty]'));
  if (choice) {
    chooseDifficulty(choice.dataset.difficulty);
    lockPointer();
  } else if (isTutorial) {
    lockPointer(); // the tutorial always plays on Easy
  } else if (!hud.isPickingDifficulty) {
    hud.showDifficultyPicker(difficultySelect.value);
  }
});
hud.endscreen.addEventListener('click', () => reload('restart')); // after the tutorial, too: on to the real game
hud.onMenuAction((action) => {
  if (action === 'resume') lockPointer();
  else if (action === 'settings') settingsMenu.showList();
  else if (action === 'restart') reload(isTutorial ? 'tutorial' : 'restart');
  else if (action === 'skip') reload('restart');
  else if (action === 'exit') reload(null);
});

// Firefox reports a refused capture only through this event; Chrome and Edge also reject the promise (see lockPointer).
document.addEventListener('pointerlockerror', () => hud.showResumeRetry());
document.addEventListener('pointerlockchange', () => {
  input.isCapturing = document.pointerLockElement === renderer.domElement; // browser shortcuts only work in menus
  screenLock.setPlaying(input.isCapturing && !game.isOver); // Ctrl+W & co. belong to the game only while it plays
  if (game.isOver) return;
  game.setPaused(document.pointerLockElement !== renderer.domElement);
});
// With the keyboard locked, a short Esc reaches the page instead of freeing the mouse: free it ourselves (pause).
window.addEventListener('keydown', (event) => {
  if (event.code === 'Escape' && input.isCapturing) document.exitPointerLock();
});

document.addEventListener('mousemove', (e) => {
  if (!player.enabled || Math.abs(e.movementX) > MAX_MOUSE_STEP || Math.abs(e.movementY) > MAX_MOUSE_STEP) return;
  player.look(e.movementX, e.movementY);
  viewModel.addSway(e.movementX, e.movementY);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  graphics.resize();
});

const timer = new THREE.Timer();
timer.connect(document);
renderer.setAnimationLoop((timestamp) => {
  devTools?.begin();
  timer.update(timestamp);
  const frameTime = timer.getDelta();
  const dt = Math.min(frameTime, MAX_DT);
  game.update(dt, timer.getElapsed());
  if (!game.isPaused && !game.isOver) measureFps(frameTime);
  dust.update(dt, player.position, flashlight.brightness, renderer.getPixelRatio());
  input.endFrame();
  graphics.render(dt);
  devTools?.end();
});

/** Saves the picked difficulty through the settings form, so the form, storage and game all follow. @param {string} name */
function chooseDifficulty(name) {
  difficultySelect.value = name;
  difficultySelect.dispatchEvent(new Event('input'));
}

/** Starts or resumes play. Must run inside a click: browsers only lock the mouse on a user gesture. */
function lockPointer() {
  audio.start();
  // Chrome refuses a re-lock for about a second after Esc; the menu simply stays open and the next click works.
  Promise.resolve(renderer.domElement.requestPointerLock()).catch(() => hud.showResumeRetry());
  screenLock.enter(); // same click: full screen also needs a user gesture
}

/** The FPS readout (when switched on), and one hint if the run starts out too slow for its graphics. @param {number} frameTime s */
function measureFps(frameTime) {
  const { fps, isTooSlow } = fpsMeter.sample(frameTime);
  if (fps !== null && settings.showFps) fpsLabel.textContent = `${fps} FPS`;
  if (isTooSlow && settings.graphics !== 'low') hud.toast(SLOW_TIP);
}

/** @returns {Storage | null} localStorage, or null where it is blocked */
function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The title screen's line of records: best escape per difficulty, journal pages, endings seen. @param {import('./core/records.js').Records} records */
function describeRecords(records) {
  if (records.escapes + records.deaths === 0) return '';
  const times = Object.entries(records.bestTimes).map(
    ([name, time]) => `${DIFFICULTIES[name].label} ${formatTime(time)}`,
  );
  const parts = [
    times.length > 0 ? `Best escape: ${times.join(' · ')}` : `Escapes: 0 of ${records.deaths} tries`,
    `Journal: ${records.mostPages}/${PAGE_COUNT} pages`,
    `Endings: ${records.endings.length}/${Object.keys(ENDINGS).length}`,
  ];
  return parts.join('  —  ');
}

/**
 * A new run is a fresh page: new random layout, new monster.
 * @param {'restart' | 'tutorial' | null} next what the next load starts; null = the full title screen
 */
function reload(next) {
  try {
    if (next) sessionStorage.setItem(LAUNCH_KEY, next);
  } catch {
    // Storage blocked: the page still reloads, just to the full title screen.
  }
  window.location.reload();
}

/** @returns {'restart' | 'tutorial' | null} how this page load was asked to start (the request is used up) */
function takeLaunch() {
  try {
    const launch = sessionStorage.getItem(LAUNCH_KEY);
    sessionStorage.removeItem(LAUNCH_KEY);
    return launch === 'restart' || launch === 'tutorial' ? launch : null;
  } catch {
    return null;
  }
}

/** Yaw that points the camera down the first open corridor next to `cell` (forward = (-sin, -cos)). */
function facingOpenCorridor(cell) {
  const [dx, dz] = DIRECTIONS.find(([x, z]) => isWalkable(level, cell.x + x, cell.z + z)) ?? [0, -1];
  return Math.atan2(-dx, -dz);
}
