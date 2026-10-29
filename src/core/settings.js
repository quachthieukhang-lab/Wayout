import * as z from 'zod/mini'; // tree-shakable build of zod: a few kB instead of ~100 kB
import { DIFFICULTY_NAMES } from './difficulty.js';

const STORAGE_KEY = 'way-out-settings';
export const GRAPHICS_LEVELS = /** @type {const} */ (['high', 'medium', 'low']);

/**
 * @typedef {typeof GRAPHICS_LEVELS[number]} GraphicsLevel
 * @typedef {{ difficulty: import('./difficulty.js').DifficultyName, masterVolume: number, ambienceVolume: number,
 *   mouseSensitivity: number, isYInverted: boolean, fov: number, brightness: number, graphics: GraphicsLevel,
 *   showFps: boolean, isFullscreen: boolean, isErrorReportingOn: boolean }} Settings
 */

/** @type {Readonly<Settings>} */
export const DEFAULT_SETTINGS = Object.freeze({
  difficulty: 'normal',
  masterVolume: 0.7,
  ambienceVolume: 1,
  mouseSensitivity: 1,
  isYInverted: false,
  fov: 75,
  brightness: 1.1,
  graphics: 'high',
  showFps: false,
  isFullscreen: true,
  isErrorReportingOn: true,
});

// Same ranges as the sliders in index.html. A missing, mistyped or out-of-range value falls back to its default
// on its own, so one bad field does not reset the others.
const rangeOr = (min, max, fallback) => z.catch(z.number().check(z.minimum(min), z.maximum(max)), fallback);
const flagOr = (fallback) => z.catch(z.boolean(), fallback);
const SettingsSchema = z.object({
  difficulty: z.catch(z.enum(DIFFICULTY_NAMES), DEFAULT_SETTINGS.difficulty),
  masterVolume: rangeOr(0, 1, DEFAULT_SETTINGS.masterVolume),
  ambienceVolume: rangeOr(0, 1, DEFAULT_SETTINGS.ambienceVolume),
  mouseSensitivity: rangeOr(0.2, 3, DEFAULT_SETTINGS.mouseSensitivity),
  isYInverted: flagOr(DEFAULT_SETTINGS.isYInverted),
  fov: rangeOr(60, 100, DEFAULT_SETTINGS.fov),
  brightness: rangeOr(0.6, 2, DEFAULT_SETTINGS.brightness),
  graphics: z.catch(z.enum(GRAPHICS_LEVELS), DEFAULT_SETTINGS.graphics),
  showFps: flagOr(DEFAULT_SETTINGS.showFps),
  isFullscreen: flagOr(DEFAULT_SETTINGS.isFullscreen),
  isErrorReportingOn: flagOr(DEFAULT_SETTINGS.isErrorReportingOn),
});

/**
 * @param {unknown} saved whatever was stored
 * @returns {Settings} valid settings, with defaults for anything missing or malformed
 */
export function parseSettings(saved) {
  const input = typeof saved === 'object' && saved !== null ? saved : {};
  // Before v1.1 graphics was a High on/off switch; its "off" is what Medium is now.
  const migrated =
    !('graphics' in input) && 'isHighQuality' in input && input.isHighQuality === false
      ? { ...input, graphics: 'medium' }
      : input;
  return /** @type {Settings} */ (SettingsSchema.parse(migrated)); // every field has a .catch, so none is ever missing
}

/** @returns {Settings} saved settings, falling back to defaults for anything missing or malformed */
export function loadSettings() {
  try {
    return parseSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return { ...DEFAULT_SETTINGS }; // storage blocked or corrupt JSON: play with defaults
  }
}

/** @param {Settings} settings */
function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (e.g. private mode): settings still apply, they just won't persist.
  }
}

const FORMATTERS = Object.freeze({
  masterVolume: (v) => `${Math.round(v * 100)}%`,
  ambienceVolume: (v) => `${Math.round(v * 100)}%`,
  mouseSensitivity: (v) => `${v.toFixed(2)}×`,
  fov: (v) => `${v}°`,
  brightness: (v) => `${v.toFixed(2)}×`,
});

/** @param {HTMLInputElement | HTMLSelectElement} input */
function readInput(input) {
  if (input instanceof HTMLSelectElement) return input.value;
  return input.type === 'checkbox' ? input.checked : Number(input.value);
}

/**
 * Settings are grouped: a list of sections (`.settings-menu` buttons with `data-section`), each opening its own
 * page (`fieldset[data-section]`) with a back button (`.settings-back`).
 * @param {HTMLElement} form
 * @returns {{ showList: () => void }} back to the list of sections
 */
export function bindSettingsMenu(form) {
  const menu = /** @type {HTMLElement} */ (form.querySelector('.settings-menu'));
  const back = /** @type {HTMLElement} */ (form.querySelector('.settings-back'));
  /** @type {HTMLElement[]} */
  const sections = [...form.querySelectorAll('fieldset[data-section]')].map((s) => /** @type {HTMLElement} */ (s));

  /** @param {string | null} name null shows the list */
  const show = (name) => {
    menu.classList.toggle('hidden', name !== null);
    back.classList.toggle('hidden', name === null);
    sections.forEach((section) => section.classList.toggle('hidden', section.dataset.section !== name));
  };
  menu.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement | null} */ (/** @type {Element} */ (event.target).closest('[data-section]'));
    if (button) show(button.dataset.section);
  });
  back.addEventListener('click', () => show(null));
  show(null);
  return { showList: () => show(null) };
}

/**
 * Wires inputs and selects marked `data-setting="<key>"` (with optional `data-output="<key>"` labels),
 * persists every change, and reports the full settings object (once immediately, then on each change).
 * @param {HTMLElement} form
 * @param {(settings: Settings) => void} onChange
 */
export function bindSettingsForm(form, onChange) {
  let settings = loadSettings();
  /** @type {NodeListOf<HTMLInputElement | HTMLSelectElement>} */ (form.querySelectorAll('[data-setting]')).forEach(
    (input) => {
      const key = input.dataset.setting;
      const output = form.querySelector(`[data-output="${key}"]`);
      const showValue = () => {
        if (output) output.textContent = FORMATTERS[key]?.(settings[key]) ?? '';
      };
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = settings[key];
      else input.value = String(settings[key]);
      showValue();

      input.addEventListener('input', () => {
        settings = parseSettings({ ...settings, [key]: readInput(input) });
        showValue();
        saveSettings(settings);
        onChange(settings);
      });
    },
  );
  onChange(settings);
}
