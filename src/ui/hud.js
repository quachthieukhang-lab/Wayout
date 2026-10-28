const TOAST_DURATION_MS = 3500;
const GRAIN_SIZE = 160;
const LOW_BATTERY = 0.2;
const LOW_HEALTH = 0.3;
const LOUD_NOISE = 0.5;
const ALERT_LABELS = Object.freeze({
  hidden: 'HIDDEN',
  calm: '',
  suspicious: '?',
  hunted: 'HUNTING YOU',
  seen: 'SEEN',
});

/** DOM HUD: keys, battery and stamina meters, prompts, screen effects and the start / end screens. */
export function createHud() {
  const $ = (id) => document.getElementById(id);
  const el = {
    overlay: $('overlay'),
    startHint: $('start-hint'),
    loadingFill: $('loading-fill'),
    endscreen: $('endscreen'),
    pause: $('pause'),
    pauseMenu: $('pause-menu'),
    pauseSettings: $('pause-settings'),
    settings: $('settings'),
    endTitle: $('end-title'),
    endText: $('end-text'),
    hud: $('hud'),
    health: $('hud-health'),
    struggle: $('struggle'),
    struggleFill: $('struggle-fill'),
    keys: $('hud-keys'),
    carried: $('hud-carried'),
    battery: $('hud-battery'),
    stamina: $('hud-stamina'),
    noise: $('hud-noise'),
    eye: $('hud-eye'),
    eyeLabel: $('hud-eye-label'),
    hint: $('hint'),
    hintArrow: $('hint-arrow'),
    hintText: $('hint-text'),
    prompt: $('prompt'),
    toast: $('toast'),
    danger: $('fx-danger'),
    flash: $('fx-flash'),
  };
  $('fx-grain').style.backgroundImage = `url(${createGrainImage()})`;

  const last = {};
  /** Only touches the DOM when a value actually changes. */
  const set = (key, value, apply) => {
    if (last[key] === value) return;
    last[key] = value;
    apply(value);
  };
  let toastTimeout = 0;
  let hasStarted = false; // after the first start, pausing shows the pause menu instead of the title screen
  // The settings form lives on the title screen; the pause menu borrows it while its Settings view is open.
  const settingsHome = { parent: el.settings.parentElement, next: el.settings.nextSibling };

  /** @param {boolean} isOpen */
  const showPauseSettings = (isOpen) => {
    el.pauseMenu.classList.toggle('hidden', isOpen);
    el.pauseSettings.classList.toggle('hidden', !isOpen);
    if (isOpen) el.pauseSettings.prepend(el.settings);
    else settingsHome.parent.insertBefore(el.settings, settingsHome.next);
  };

  return {
    overlay: el.overlay,
    endscreen: el.endscreen,

    /** Start screen while assets load. @param {number | null} progress 0..1, or null once the game can start */
    setLoading(progress) {
      const isLoading = progress !== null;
      el.overlay.classList.toggle('loading', isLoading);
      el.startHint.textContent = isLoading ? `Loading… ${Math.round(progress * 100)}%` : 'Click to start';
      el.loadingFill.style.width = `${(progress ?? 1) * 100}%`;
    },

    /** @param {boolean} isPaused */
    setPaused(isPaused) {
      if (!isPaused) hasStarted = true;
      el.overlay.classList.toggle('hidden', !isPaused || hasStarted);
      el.pause.classList.toggle('hidden', !isPaused || !hasStarted);
      showPauseSettings(false);
    },

    /** Restarting: the title screen shrinks to a "click to play" prompt. @param {boolean} isQuick */
    setQuickStart(isQuick) {
      el.overlay.classList.toggle('quick', isQuick);
    },

    /** @param {(action: 'resume' | 'settings' | 'back' | 'restart' | 'exit') => void} handler a pause-menu button was clicked */
    onMenuAction(handler) {
      el.pause.addEventListener('click', (event) => {
        const button = /** @type {HTMLElement | null} */ (
          /** @type {Element} */ (event.target).closest('[data-action]')
        );
        if (!button) return;
        const action = /** @type {'resume' | 'settings' | 'back' | 'restart' | 'exit'} */ (button.dataset.action);
        if (action === 'settings' || action === 'back') showPauseSettings(action === 'settings');
        handler(action);
      });
    },

    /**
     * @param {{ health: number, keysFound: number, totalKeys: number, battery: number, stamina: number, isExhausted: boolean,
     *   danger: number, alert: 'hidden' | 'calm' | 'suspicious' | 'hunted' | 'seen', awareness: number, noise: number,
     *   carried: string[] }} status `carried`: what the player holds, the last one is thrown first
     */
    update({ health, keysFound, totalKeys, battery, stamina, isExhausted, danger, alert, awareness, noise, carried }) {
      set('health', Math.round(health * 100), (percent) => {
        el.health.style.width = `${percent}%`;
        el.health.classList.toggle('low', health < LOW_HEALTH);
      });
      set('keys', `Keys: ${keysFound}/${totalKeys}`, (text) => {
        el.keys.textContent = text;
      });
      set('carried', [...carried].reverse().join(' · '), (text) => {
        el.carried.textContent = `[G] Throw: ${text}`;
        el.carried.classList.toggle('hidden', text === '');
      });
      set('battery', Math.round(battery * 100), (percent) => {
        el.battery.style.width = `${percent}%`;
        el.battery.classList.toggle('low', battery < LOW_BATTERY);
      });
      set('stamina', Math.round(stamina * 100), (percent) => {
        el.stamina.style.width = `${percent}%`;
      });
      set('exhausted', isExhausted, (value) => el.stamina.classList.toggle('low', value));
      set('danger', danger.toFixed(2), (opacity) => {
        el.danger.style.opacity = opacity;
      });
      set('noise', Math.round(noise * 100), (percent) => {
        el.noise.style.width = `${percent}%`;
        el.noise.classList.toggle('low', noise > LOUD_NOISE);
      });
      set('alert', alert, (value) => {
        el.eye.className = `alert-${value}`;
        el.eyeLabel.textContent = ALERT_LABELS[value];
      });
      set('awareness', awareness.toFixed(2), (value) => el.eye.style.setProperty('--awareness', value));
    },

    /** @param {number | null} progress 0..1 while grabbed, null hides the struggle meter */
    setStruggle(progress) {
      el.struggle.classList.toggle('hidden', progress === null);
      if (progress !== null) el.struggleFill.style.width = `${Math.round(progress * 100)}%`;
    },

    /** @param {{ angle: number, label: string } | null} hint direction (radians, 0 = ahead) and text; null hides it */
    setHint(hint) {
      set('hintVisible', hint !== null, (isVisible) => el.hint.classList.toggle('hidden', !isVisible));
      if (hint === null) return;
      el.hintArrow.style.transform = `rotate(${hint.angle.toFixed(3)}rad)`;
      set('hintText', hint.label, (text) => {
        el.hintText.textContent = text;
      });
    },

    /** @param {string} text empty string hides the prompt */
    setPrompt(text) {
      set('prompt', text, (value) => {
        el.prompt.textContent = value;
      });
    },

    /** @param {string} text */
    toast(text) {
      el.toast.textContent = text;
      el.toast.classList.add('visible');
      clearTimeout(toastTimeout);
      toastTimeout = setTimeout(() => el.toast.classList.remove('visible'), TOAST_DURATION_MS);
    },

    /** Red full-screen flash (restarts the CSS animation). */
    flash() {
      el.flash.classList.remove('active');
      void el.flash.offsetWidth; // force reflow so the animation replays
      el.flash.classList.add('active');
    },

    /** @param {boolean} isWin @param {string} text */
    showEnd(isWin, text) {
      el.endTitle.textContent = isWin ? 'YOU ESCAPED' : 'YOU DIED';
      el.endText.textContent = text;
      el.endscreen.classList.toggle('win', isWin);
      el.endscreen.classList.remove('hidden');
      el.overlay.classList.add('hidden');
      el.pause.classList.add('hidden');
      el.hud.classList.add('hidden');
      el.danger.style.opacity = '0';
    },
  };
}

/** Static film-grain tile; CSS animates its position. */
function createGrainImage() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = GRAIN_SIZE;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(GRAIN_SIZE, GRAIN_SIZE);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = Math.random() * 255;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
    image.data[i + 3] = 28;
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL();
}
