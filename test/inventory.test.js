import { describe, it, expect } from 'vitest';
import { Inventory, INVENTORY_SLOTS } from '../src/items/inventory.js';
import { PickupType } from '../src/items/pickups.js';

const item = (type) => ({ type, cell: { x: 0, z: 0 }, mesh: null, phase: 0, isTaken: true });

describe('Inventory', () => {
  it('starts with empty slots and the first one selected', () => {
    const bag = new Inventory();
    expect(bag.slots).toEqual(Array(INVENTORY_SLOTS).fill(null));
    expect(bag.selected).toBe(0);
    expect(bag.selectedItem).toBeNull();
    expect(bag.isFull).toBe(false);
  });

  it('puts a new item in the selected slot when it is free, otherwise in the first free one, and selects it', () => {
    const bag = new Inventory(3);
    const bottle = item(PickupType.BOTTLE);
    const can = item(PickupType.CAN);
    bag.select(1);
    expect(bag.add(bottle)).toBe(true);
    expect(bag.slots).toEqual([null, bottle, null]);

    expect(bag.add(can)).toBe(true);
    expect(bag.slots).toEqual([can, bottle, null]);
    expect(bag.selectedItem).toBe(can);
  });

  it('refuses an item once every slot is taken', () => {
    const bag = new Inventory(2);
    bag.add(item(PickupType.BOTTLE));
    bag.add(item(PickupType.BATTERY));
    expect(bag.isFull).toBe(true);
    expect(bag.add(item(PickupType.CAN))).toBe(false);
  });

  it('empties only the selected slot and keeps the selection on it', () => {
    const bag = new Inventory(2);
    const bottle = item(PickupType.BOTTLE);
    const battery = item(PickupType.BATTERY);
    bag.add(bottle);
    bag.add(battery);
    expect(bag.removeSelected()).toBe(battery);
    expect(bag.slots).toEqual([bottle, null]);
    expect(bag.selected).toBe(1);
    expect(bag.removeSelected()).toBeNull(); // already empty
  });

  it('ignores out-of-range picks and wraps around with the wheel', () => {
    const bag = new Inventory(4);
    bag.select(9);
    expect(bag.selected).toBe(0);
    bag.cycle(-1);
    expect(bag.selected).toBe(3);
    bag.cycle(1);
    expect(bag.selected).toBe(0);
  });

  it('takes bottles, cans and batteries, but never keys', () => {
    expect(Inventory.accepts(item(PickupType.BATTERY))).toBe(true);
    expect(Inventory.accepts(item(PickupType.CAN))).toBe(true);
    expect(Inventory.accepts(item(PickupType.KEY))).toBe(false);
  });
});
