import * as z from 'zod/mini'; // tree-shakable build of zod: a few kB instead of ~100 kB
import { DIFFICULTY_NAMES } from './difficulty.js';

const STORAGE_KEY = 'way-out-settings';

/**
 * @typedef {{ difficulty: import('./difficulty.js').DifficultyName, masterVolume: number, ambienceVolume: number,
 *   mouseSensitivity: number, isYInverted: boolean, fov: number, brightness: number, isHighQuality: boolean }} Settings
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
  isHighQuality: true,
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
  isHighQuality: flagOr(DEFAULT_SETTINGS.isHighQuality),
});

/**
 * @param {unknown} saved whatever was stored
 * @returns {Settings} valid settings, with defaults for anything missing or malformed
 */
export function parseSettings(saved) {
  const input = typeof saved === 'object' && saved !== null ? saved : {};
  return /** @type {Settings} */ (SettingsSchema.parse(input)); // every field has a .catch, so none is ever missing
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
