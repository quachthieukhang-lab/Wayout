// Keyboard and mouse-button state: `isDown` for held keys, `wasPressed` for keys pressed this frame.
// Mouse buttons are reported as `Mouse0` (left), `Mouse1`, `Mouse2`; wheel turns as `WheelUp` / `WheelDown`.

// Keys the browser keeps even mid-game: Esc frees the mouse (the pause menu), F11 toggles fullscreen.
const BROWSER_KEYS = new Set(['Escape', 'F11']);

export class Input {
  constructor(target = window) {
    this.keys = new Set();
    this.pressed = new Set();
    /** While playing, every other key belongs to the game: mashed keys must not fire F12, Ctrl+Shift+C, Ctrl+S... */
    this.isCapturing = false;

    target.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || (this.isCapturing && !BROWSER_KEYS.has(e.code))) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('mousedown', (e) => this.pressed.add(`Mouse${e.button}`));
    target.addEventListener(
      'wheel',
      (e) => {
        if (this.isCapturing && e.ctrlKey) e.preventDefault(); // Ctrl + wheel would zoom the page
        if (e.deltaY !== 0) this.pressed.add(e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
      },
      { passive: false },
    );
    target.addEventListener('blur', () => this.keys.clear()); // keys released while the tab was away never send keyup
  }

  isDown(...codes) {
    return codes.some((code) => this.keys.has(code));
  }

  wasPressed(...codes) {
    return codes.some((code) => this.pressed.has(code));
  }

  endFrame() {
    this.pressed.clear();
  }
}
