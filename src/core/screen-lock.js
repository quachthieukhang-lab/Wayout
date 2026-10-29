/**
 * Full screen while playing, with the keyboard locked so Ctrl+W, Ctrl+Tab, Ctrl+T... reach the game instead of
 * closing or leaving it. Keyboard Lock exists only in Chromium browsers (Chrome, Edge) and only in full screen;
 * elsewhere the game just goes full screen. The menus get every shortcut back (the lock is released on pause).
 * @typedef {{ lock: (codes?: string[]) => Promise<void>, unlock: () => void }} KeyboardLock
 * @typedef {{ fullscreenElement: Element | null, documentElement: { requestFullscreen: (options?: FullscreenOptions) => Promise<void> } }} FullscreenDocument
 */

/**
 * @param {{ doc?: FullscreenDocument, keyboard?: KeyboardLock | null }} [platform] defaults: the real document and
 *   `navigator.keyboard`
 */
export function createScreenLock({
  doc = document,
  keyboard = /** @type {{ keyboard?: KeyboardLock }} */ (/** @type {unknown} */ (navigator)).keyboard ?? null,
} = {}) {
  let isEnabled = true;
  let isLocked = false;

  const lockKeys = () => {
    if (!keyboard || isLocked || !doc.fullscreenElement) return;
    isLocked = true;
    keyboard.lock().catch(() => {
      isLocked = false; // refused (not full screen yet, or a frame): Ctrl+W still works, nothing else breaks
    });
  };

  return {
    /** @param {boolean} value the "Full screen while playing" setting */
    setEnabled(value) {
      isEnabled = value;
    },

    get isKeyboardLocked() {
      return isLocked;
    },

    /** Must run inside the click that starts or resumes play: browsers only go full screen on a user gesture. */
    enter() {
      if (!isEnabled) return;
      if (doc.fullscreenElement) {
        lockKeys();
        return;
      }
      doc.documentElement
        .requestFullscreen({ navigationUI: 'hide' })
        .then(lockKeys)
        .catch(() => {}); // refused or unsupported: the game still plays in the window
    },

    /** Playing takes every key; a menu gives them back. @param {boolean} isPlaying */
    setPlaying(isPlaying) {
      if (isPlaying && isEnabled) {
        lockKeys();
      } else if (isLocked) {
        keyboard?.unlock();
        isLocked = false;
      }
    },
  };
}
