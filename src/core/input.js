// Keyboard and mouse-button state: `isDown` for held keys, `wasPressed` for keys pressed this frame.
// Mouse buttons are reported as `Mouse0` (left), `Mouse1`, `Mouse2`.
export class Input {
  constructor(target = window) {
    this.keys = new Set();
    this.pressed = new Set();

    target.addEventListener('keydown', (e) => {
      if (e.code === 'Space') e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('mousedown', (e) => this.pressed.add(`Mouse${e.button}`));
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
