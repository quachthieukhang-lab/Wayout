import { describe, it, expect } from 'vitest';
import { Input } from '../src/core/input.js';

const key = (type, code) => Object.assign(new Event(type, { cancelable: true }), { code });
const mouse = (button) => Object.assign(new Event('mousedown'), { button });

describe('Input', () => {
  it('reports a held key until it is released', () => {
    const target = new EventTarget();
    const input = new Input(target);
    target.dispatchEvent(key('keydown', 'KeyW'));
    expect(input.isDown('KeyW')).toBe(true);
    expect(input.isDown('KeyS', 'KeyW')).toBe(true);
    target.dispatchEvent(key('keyup', 'KeyW'));
    expect(input.isDown('KeyW')).toBe(false);
  });

  it('reports a press for one frame only, and not again for key repeat', () => {
    const target = new EventTarget();
    const input = new Input(target);
    target.dispatchEvent(key('keydown', 'KeyE'));
    expect(input.wasPressed('KeyE')).toBe(true);
    input.endFrame();
    target.dispatchEvent(key('keydown', 'KeyE')); // auto-repeat while held
    expect(input.wasPressed('KeyE')).toBe(false);
  });

  it('reports mouse buttons as Mouse0, Mouse1, ...', () => {
    const target = new EventTarget();
    const input = new Input(target);
    target.dispatchEvent(mouse(0));
    expect(input.wasPressed('KeyG', 'Mouse0')).toBe(true);
    expect(input.wasPressed('Mouse2')).toBe(false);
  });

  it('keeps Space from scrolling the page', () => {
    const target = new EventTarget();
    new Input(target);
    const space = key('keydown', 'Space');
    target.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(true);
  });

  it('forgets held keys when the window loses focus', () => {
    const target = new EventTarget();
    const input = new Input(target);
    target.dispatchEvent(key('keydown', 'KeyD'));
    target.dispatchEvent(new Event('blur'));
    expect(input.isDown('KeyD')).toBe(false); // otherwise you keep walking after alt-tab
  });
});
