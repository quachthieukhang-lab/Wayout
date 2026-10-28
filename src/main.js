import * as THREE from 'three';
import { LEVEL_MAP, ROOMS, parseLevel, cellToWorld, isWalkable } from './level/level.js';
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
import { bindSettingsForm } from './core/settings.js';
import { DIFFICULTIES } from './core/difficulty.js';
import { scatterItems } from './level/scatter.js';
import { TUTORIAL_MAP, TUTORIAL_ROOMS } from './level/tutorial-map.js';
import { Tutorial } from './core/tutorial.js';
import { createGraphics } from './render/graphics.js';
import { createDust } from './world/dust.js';

const MAX_DT = 0.05;
// sessionStorage: how the next page load starts. 'restart' = a new run with a compact title screen,
// 'tutorial' = the tutorial. Absent = the full title screen.
const LAUNCH_KEY = 'way-out-launch';
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

const launch = takeLaunch();
const isTutorial = launch === 'tutorial';
// Keys and throwables land somewhere new every run; the tutorial is always laid out the same.
const level = isTutorial ? parseLevel(TUTORIAL_MAP) : scatterItems(parseLevel(LEVEL_MAP));
const world = createWorld(level, isTutorial ? TUTORIAL_ROOMS : ROOMS);
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
const tutorial = isTutorial ? new Tutorial() : null;
const game = new Game({
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

bindSettingsForm(document.getElementById('settings'), (settings) => {
  game.setDifficulty(DIFFICULTIES[settings.difficulty]);
  audio.setVolumes(settings.masterVolume, settings.ambienceVolume);
  player.mouseSensitivity = settings.mouseSensitivity;
  player.isYInverted = settings.isYInverted;
  player.baseFov = settings.fov;
  renderer.toneMappingExposure = settings.brightness;
  graphics.setQuality(settings.isHighQuality);
});

hud.setQuickStart(launch !== null);
hud.setTutorial(isTutorial);
hud.overlay.addEventListener('click', (event) => {
  const target = /** @type {Element} */ (event.target);
  if (!isReady || target.closest('#settings')) return; // adjusting a slider must not start the game
  if (target.closest('#tutorial-button')) reload('tutorial');
  else lockPointer();
});
hud.endscreen.addEventListener('click', () => reload('restart')); // after the tutorial, too: on to the real game
hud.onMenuAction((action) => {
  if (action === 'resume') lockPointer();
  else if (action === 'restart') reload(isTutorial ? 'tutorial' : 'restart');
  else if (action === 'skip') reload('restart');
  else if (action === 'exit') reload(null);
});

document.addEventListener('pointerlockchange', () => {
  if (game.isOver) return;
  game.setPaused(document.pointerLockElement !== renderer.domElement);
});

document.addEventListener('mousemove', (e) => {
  if (!player.enabled) return;
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
  const dt = Math.min(timer.getDelta(), MAX_DT);
  game.update(dt, timer.getElapsed());
  dust.update(dt, player.position, flashlight.brightness, renderer.getPixelRatio());
  input.endFrame();
  graphics.render(dt);
  devTools?.end();
});

/** Starts or resumes play. Must run inside a click: browsers only lock the mouse on a user gesture. */
function lockPointer() {
  audio.start();
  // Chrome refuses a re-lock for about a second after Esc; the menu simply stays open and the next click works.
  Promise.resolve(renderer.domElement.requestPointerLock()).catch(() => {});
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
