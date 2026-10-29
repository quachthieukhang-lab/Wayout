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

  it('reports wheel turns as WheelUp and WheelDown', () => {
    const target = new EventTarget();
    const input = new Input(target);
    target.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: -120 }));
    expect(input.wasPressed('WheelUp')).toBe(true);
    expect(input.wasPressed('WheelDown')).toBe(false);
    input.endFrame();
    target.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: 0 })); // sideways scroll
    expect(input.wasPressed('WheelUp', 'WheelDown')).toBe(false);
  });

  it('while playing, keeps browser shortcuts (F12, Ctrl+Shift+C, Ctrl+wheel zoom) from firing, but not Esc or F11', () => {
    const target = new EventTarget();
    const input = new Input(target);
    input.isCapturing = true;
    const shortcuts = ['F12', 'KeyC', 'KeyU', 'KeyS'].map((code) => key('keydown', code));
    const kept = ['Escape', 'F11'].map((code) => key('keydown', code));
    const zoom = Object.assign(new Event('wheel', { cancelable: true }), { deltaY: -100, ctrlKey: true });
    [...shortcuts, ...kept, zoom].forEach((event) => target.dispatchEvent(event));

    expect(shortcuts.every((event) => event.defaultPrevented)).toBe(true);
    expect(kept.some((event) => event.defaultPrevented)).toBe(false);
    expect(zoom.defaultPrevented).toBe(true);
    expect(input.wasPressed('F12', 'KeyC', 'WheelUp')).toBe(true); // the game still sees them
  });

  it('in the menus, leaves the browser its shortcuts', () => {
    const target = new EventTarget();
    new Input(target);
    const devTools = key('keydown', 'F12');
    target.dispatchEvent(devTools);
    expect(devTools.defaultPrevented).toBe(false);
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
