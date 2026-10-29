import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from '../src/core/settings.js';

describe('parseSettings', () => {
  it('keeps valid saved values', () => {
    const saved = { ...DEFAULT_SETTINGS, fov: 90, isYInverted: true };
    expect(parseSettings(saved)).toEqual(saved);
  });

  it('replaces only the out-of-range or mistyped fields with their defaults', () => {
    const settings = parseSettings({ ...DEFAULT_SETTINGS, fov: 999, masterVolume: 'loud', brightness: 1.5 });
    expect(settings.fov).toBe(DEFAULT_SETTINGS.fov);
    expect(settings.masterVolume).toBe(DEFAULT_SETTINGS.masterVolume);
    expect(settings.brightness).toBe(1.5);
  });

  it('keeps a known difficulty and falls back to Normal for anything else', () => {
    expect(parseSettings({ difficulty: 'hard' }).difficulty).toBe('hard');
    expect(parseSettings({ difficulty: 'nightmare' }).difficulty).toBe('normal');
    expect(parseSettings({ difficulty: 2 }).difficulty).toBe('normal');
  });

  it('keeps a known graphics level, and turns the old High switch being off into Medium', () => {
    expect(parseSettings({ graphics: 'low' }).graphics).toBe('low');
    expect(parseSettings({ graphics: 'ultra' }).graphics).toBe('high');
    expect(parseSettings({ isHighQuality: false }).graphics).toBe('medium');
    expect(parseSettings({ isHighQuality: true }).graphics).toBe('high');
    expect(parseSettings({ isHighQuality: false })).not.toHaveProperty('isHighQuality');
  });

  it('fills in missing fields and survives garbage', () => {
    expect(parseSettings({ fov: 80 })).toEqual({ ...DEFAULT_SETTINGS, fov: 80 });
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
  });
});
