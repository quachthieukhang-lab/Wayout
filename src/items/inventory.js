import { PickupType } from './pickups.js';

export const INVENTORY_SLOTS = 4;

/**
 * The player's bag: a few slots for bottles, cans and spare batteries (keys are counted apart and never take a slot).
 * One slot is selected; G / click uses what is in it, X drops it.
 */
export class Inventory {
  constructor(size = INVENTORY_SLOTS) {
    /** @type {(import('./pickups.js').Pickup | null)[]} */
    this.slots = Array.from({ length: size }, () => null);
    this.selected = 0;
  }

  /** @param {import('./pickups.js').Pickup} item */
  static accepts(item) {
    return item.type !== PickupType.KEY;
  }

  get isFull() {
    return this.slots.every((slot) => slot !== null);
  }

  get selectedItem() {
    return this.slots[this.selected];
  }

  /**
   * Puts an item in the selected slot if it is free, otherwise in the first free one, and selects it.
   * @param {import('./pickups.js').Pickup} item
   * @returns {boolean} false when the bag is full
   */
  add(item) {
    const index = this.selectedItem === null ? this.selected : this.slots.indexOf(null);
    if (index === -1) return false;
    this.slots[index] = item;
    this.selected = index;
    return true;
  }

  /** Empties the selected slot (the selection stays on it). @returns {import('./pickups.js').Pickup | null} */
  removeSelected() {
    const item = this.selectedItem;
    this.slots[this.selected] = null;
    return item;
  }

  /** @param {number} index out-of-range picks are ignored */
  select(index) {
    if (index >= 0 && index < this.slots.length) this.selected = index;
  }

  /** Mouse wheel: the next or previous slot, wrapping around. @param {number} step +1 or -1 */
  cycle(step) {
    const size = this.slots.length;
    this.selected = (((this.selected + step) % size) + size) % size;
  }
}
