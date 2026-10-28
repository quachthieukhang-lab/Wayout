import { describe, it, expect } from 'vitest';
import { parseLevel, cellToWorld, exitApproach } from '../src/level/level.js';
import { KeySense, findNearestRoute } from '../src/items/key-sense.js';

const level = parseLevel(['#########', '#P..#..K#', '#.#.#.#.#', '#.#...#.E', '#K#####M#', '#########']);

describe('findNearestRoute', () => {
  it('picks the key with the shortest walk and aims two steps along it', () => {
    const route = findNearestRoute(level, level.spawn, level.keys);
    expect(route.distance).toBe(3 * 3); // down to (1,4): 3 cells of 3 m
    expect(route.aim).toEqual(cellToWorld({ x: 1, z: 3 }));
  });

  it('aims around corners instead of through walls', () => {
    const route = findNearestRoute(level, { x: 3, z: 1 }, [{ x: 7, z: 1 }]);
    expect(route.aim).toEqual(cellToWorld({ x: 3, z: 3 })); // the wall at (4,1) is in the way, so it heads down first
  });

  it('starts from an open neighbour when the player stands on a blocked cell, and returns null without goals', () => {
    expect(findNearestRoute(level, { x: 2, z: 2 }, level.keys)).not.toBeNull();
    expect(findNearestRoute(level, level.spawn, [])).toBeNull();
  });

  it('finds the floor cell in front of the exit', () => {
    expect(exitApproach(level)).toEqual({ x: 7, z: 3 });
  });
});

describe('KeySense', () => {
  const spawn = cellToWorld(level.spawn);

  it('shows a route only while active, then needs to cool down', () => {
    const sense = new KeySense(level);
    expect(sense.update(0.1, spawn, level.keys)).toBeNull();

    expect(sense.activate()).toBe(true);
    expect(sense.update(0.1, spawn, level.keys)).not.toBeNull();
    expect(sense.activate()).toBe(false); // still recovering

    sense.update(7, spawn, level.keys);
    expect(sense.update(0.1, spawn, level.keys)).toBeNull(); // worn off
    sense.update(10, spawn, level.keys);
    expect(sense.activate()).toBe(true);
  });

  it('recovers faster or slower with the difficulty', () => {
    const quick = new KeySense(level);
    quick.cooldownScale = 0.5;
    quick.activate();
    quick.update(8, spawn, level.keys); // more than half of the normal 15 s
    expect(quick.activate()).toBe(true);

    const slow = new KeySense(level);
    slow.cooldownScale = 1.6;
    slow.activate();
    slow.update(16, spawn, level.keys);
    expect(slow.activate()).toBe(false);
  });
});
