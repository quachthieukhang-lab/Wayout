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
const SVG_OPEN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">';
/** Line icons for what can sit in the bag, plus the key. Fixed strings, never built from input. */
const ITEM_ICONS = Object.freeze({
  bottle: `${SVG_OPEN}<path d="M10 2.5h4V7l2 3v10.5a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10l2-3z"/><path d="M8 14h8"/></svg>`,
  can: `${SVG_OPEN}<rect x="7" y="4" width="10" height="16" rx="2"/><path d="M7 7.5h10M7 16.5h10"/></svg>`,
  battery: `${SVG_OPEN}<rect x="7.5" y="5" width="9" height="16" rx="1.5"/><path d="M10.5 3h3v2h-3z"/><path d="M12.8 9l-2 4h2.6l-2 4"/></svg>`,
  key: `${SVG_OPEN}<circle cx="7" cy="12" r="3.5"/><path d="M10.5 12H21M17.5 12v3M20.5 12v2.5"/></svg>`,
});
/** What G / click does with the selected item. */
const ITEM_ACTIONS = Object.freeze({ bottle: 'Throw', can: 'Throw', battery: 'Put in flashlight' });

/** DOM HUD: keys, the vitals meters, the bag's slots, prompts, screen effects and the start / end screens. */
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
    difficultyPicker: $('difficulty-picker'),
    resumeRetry: $('resume-retry'),
    skipTutorial: $('skip-tutorial'),
    tutorialButton: $('tutorial-button'),
    objective: $('objective'),
    objectiveStep: $('objective-step'),
    objectiveText: $('objective-text'),
    endHint: $('end-hint'),
    endTitle: $('end-title'),
    endText: $('end-text'),
    hud: $('hud'),
    health: $('hud-health'),
    struggle: $('struggle'),
    struggleFill: $('struggle-fill'),
    keyIcons: $('hud-key-icons'),
    keyCount: $('hud-key-count'),
    slots: $('hud-slots'),
    bagAction: $('hud-bag-action'),
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
  /** @type {(string | null)[]} what the slots held last time, so a newly filled one can light up */
  let lastSlots = [];
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
      if (!isPaused) {
        hasStarted = true;
        // A menu button keeps focus after the click; Space (jump) would press it again.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }
      el.overlay.classList.toggle('hidden', !isPaused || hasStarted);
      el.pause.classList.toggle('hidden', !isPaused || !hasStarted);
      el.resumeRetry.classList.add('hidden');
      showPauseSettings(false);
    },

    /** The browser refused to capture the mouse (Chrome and Edge do for about a second after Esc). */
    showResumeRetry() {
      el.resumeRetry.classList.remove('hidden');
    },

    /** Asks which difficulty to play before the run starts. @param {string} current the saved choice, highlighted */
    showDifficultyPicker(current) {
      el.difficultyPicker.classList.remove('hidden');
      el.startHint.classList.add('hidden');
      el.difficultyPicker.querySelectorAll('[data-difficulty]').forEach((button) => {
        button.classList.toggle('selected', /** @type {HTMLElement} */ (button).dataset.difficulty === current);
      });
    },

    get isPickingDifficulty() {
      return !el.difficultyPicker.classList.contains('hidden');
    },

    /** Restarting: the title screen shrinks to a "click to play" prompt. @param {boolean} isQuick */
    setQuickStart(isQuick) {
      el.overlay.classList.toggle('quick', isQuick);
    },

    /** In the tutorial the pause menu offers to skip it, and the title screen does not offer it again. @param {boolean} isTutorial */
    setTutorial(isTutorial) {
      el.skipTutorial.classList.toggle('hidden', !isTutorial);
      el.tutorialButton.classList.toggle('hidden', isTutorial);
    },

    /** The tutorial's current objective. @param {{ step: string, text: string } | null} objective null hides it */
    setObjective(objective) {
      el.objective.classList.toggle('hidden', objective === null);
      if (objective === null) return;
      el.objectiveStep.textContent = objective.step;
      el.objectiveText.textContent = objective.text;
      el.objective.classList.remove('new');
      void el.objective.offsetWidth; // restart the highlight animation
      el.objective.classList.add('new');
    },

    /** @param {(action: 'resume' | 'settings' | 'back' | 'restart' | 'exit' | 'skip') => void} handler a pause-menu button was clicked */
    onMenuAction(handler) {
      el.pause.addEventListener('click', (event) => {
        const button = /** @type {HTMLElement | null} */ (
          /** @type {Element} */ (event.target).closest('[data-action]')
        );
        if (!button) return;
        const action = /** @type {'resume' | 'settings' | 'back' | 'restart' | 'exit' | 'skip'} */ (
          button.dataset.action
        );
        if (action === 'settings' || action === 'back') showPauseSettings(action === 'settings');
        handler(action);
      });
    },

    /**
     * @param {{ health: number, keysFound: number, totalKeys: number, battery: number, stamina: number, isExhausted: boolean,
     *   danger: number, alert: 'hidden' | 'calm' | 'suspicious' | 'hunted' | 'seen', awareness: number, noise: number,
     *   inventory: { slots: (string | null)[], selected: number } }} status `inventory`: the item kind in each bag slot
     */
    update({
      health,
      keysFound,
      totalKeys,
      battery,
      stamina,
      isExhausted,
      danger,
      alert,
      awareness,
      noise,
      inventory,
    }) {
      set('health', Math.round(health * 100), (percent) => {
        el.health.style.width = `${percent}%`;
        el.health.classList.toggle('low', health < LOW_HEALTH);
      });
      set('keys', `${keysFound}/${totalKeys}`, (text) => {
        renderKeys(el.keyIcons, keysFound, totalKeys);
        el.keyCount.textContent = text;
      });
      set('inventory', `${inventory.slots.join(',')}|${inventory.selected}`, () => {
        renderSlots(el.slots, inventory, lastSlots);
        lastSlots = [...inventory.slots];
        renderBagAction(el.bagAction, inventory.slots[inventory.selected]);
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

    /** @param {boolean} isWin @param {string} text @param {{ title?: string, hint?: string }} [labels] */
    showEnd(isWin, text, { title = isWin ? 'YOU ESCAPED' : 'YOU DIED', hint = 'Click to play again' } = {}) {
      el.endTitle.textContent = title;
      el.endHint.textContent = hint;
      el.objective.classList.add('hidden');
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

/** One key outline per key in the level, filled in gold once found. */
function renderKeys(container, found, total) {
  if (container.childElementCount !== total) {
    container.replaceChildren(
      ...Array.from({ length: total }, () => {
        const icon = document.createElement('span');
        icon.className = 'key-icon';
        icon.innerHTML = ITEM_ICONS.key;
        return icon;
      }),
    );
  }
  [...container.children].forEach((icon, i) => icon.classList.toggle('found', i < found));
}

/**
 * The bag as a row of boxes: slot number, item icon, the selected one outlined.
 * @param {HTMLElement} container @param {{ slots: (string | null)[], selected: number }} inventory
 * @param {(string | null)[]} previous the slots before this change
 */
function renderSlots(container, { slots, selected }, previous) {
  if (container.childElementCount !== slots.length) {
    container.replaceChildren(
      ...slots.map((_, i) => {
        const slot = document.createElement('div');
        slot.className = 'slot';
        const number = document.createElement('span');
        number.className = 'slot-number';
        number.textContent = String(i + 1);
        const icon = document.createElement('span');
        icon.className = 'slot-icon';
        slot.append(number, icon);
        return slot;
      }),
    );
  }
  slots.forEach((type, i) => {
    const slot = /** @type {HTMLElement} */ (container.children[i]);
    slot.classList.toggle('selected', i === selected);
    slot.classList.toggle('filled', type !== null);
    slot.title = type ?? '';
    if (type === (previous[i] ?? null)) return;
    slot.dataset.item = type ?? '';
    /** @type {HTMLElement} */ (slot.lastElementChild).innerHTML = type ? ITEM_ICONS[type] : '';
    if (!type) return;
    slot.classList.remove('new');
    void slot.offsetWidth; // restart the pop animation
    slot.classList.add('new');
  });
}

/** Above the bag: the selected item's name and what G / X do with it. @param {HTMLElement} line @param {string | null} type */
function renderBagAction(line, type) {
  line.classList.toggle('hidden', !type);
  if (!type) return;
  const label = (text) => {
    const span = document.createElement('span');
    span.textContent = text;
    return span;
  };
  const key = (text) => {
    const kbd = document.createElement('kbd');
    kbd.textContent = text;
    return kbd;
  };
  const name = label(type);
  name.className = 'bag-item-name';
  line.replaceChildren(name, key('G'), label(ITEM_ACTIONS[type]), key('X'), label('Drop'));
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
