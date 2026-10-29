import { MonsterState } from '../monster/monster.js';
import { PickupType } from '../items/pickups.js';
import { THROWABLE, THROW_SPEED, Throwing } from '../items/throwables.js';
import { Inventory, INVENTORY_SLOTS } from '../items/inventory.js';
import { Flares, FLARE_LURE_RADIUS } from '../items/flares.js';

const BATTERY_RECHARGE = 0.45;
const FULL_BATTERY = 0.99; // a fresh battery would be wasted above this
export const BANDAGE_HEAL = 45;
const FLARE_STUN = 3.5;
const USE_KEYS = ['KeyG', 'Mouse0']; // throw the selected bottle, can or flare; put a battery in; use a bandage
const DROP_KEY = 'KeyX';
const DROP_AHEAD = 0.3; // m in front of the feet: less than the player's radius, so never inside a wall
const DROP_VOLUME = 0.15;
const SLOT_KEYS = Array.from({ length: INVENTORY_SLOTS }, (_, i) => `Digit${i + 1}`);
/** @type {Set<string>} what in the bag could lure it away */
const LURE_TYPES = new Set([PickupType.BOTTLE, PickupType.CAN, PickupType.FLARE]);
/** Shown the first time each kind of item goes in the bag. */
const ITEM_TIPS = Object.freeze({
  [PickupType.BOTTLE]: 'Picked up a bottle — press G or click to throw it and lure it away',
  [PickupType.CAN]: 'Picked up a can — press G or click to throw it and lure it away',
  [PickupType.BATTERY]: 'Battery in your bag — select it and press G or click to put it in the flashlight',
  [PickupType.BANDAGE]: 'Picked up a bandage — select it and press G to patch yourself up',
  [PickupType.FLARE]: 'Picked up a flare — throw it (G): its light and hiss lure it, and the glare blinds it up close',
});

/**
 * @typedef {import('../items/pickups.js').Pickup} Pickup
 * @typedef {{
 *   scene: import('three').Object3D, colliders: import('three').Box3[], camera: import('three').Camera,
 *   input: import('./input.js').Input, player: import('../player/player.js').Player,
 *   flashlight: import('../player/flashlight.js').Flashlight, monster: import('../monster/monster.js').Monster,
 *   pickups: ReturnType<typeof import('../items/pickups.js').createPickups>,
 *   audio: import('../audio/audio.js').HorrorAudio, hud: ReturnType<typeof import('../ui/hud.js').createHud>,
 *   heal: (amount: number) => boolean,
 * }} BagDeps `heal` returns false when the player is not hurt
 */

/**
 * The bag and what comes out of it: 1-4 or the wheel select a slot, G / click use it (throw a bottle, can or flare,
 * put a battery in, bind a wound), X drops it. Thrown things fly here too, and the one burning flare.
 */
export class Bag {
  /** @param {BagDeps} deps */
  constructor(deps) {
    this.deps = deps;
    this.inventory = new Inventory();
    this.throwing = new Throwing(deps.scene, deps.colliders);
    this.flares = new Flares(deps.scene);
    this.itemTips = new Set(); // item kinds whose use was already explained
  }

  /** Something in the bag could still lure it away. */
  get hasLure() {
    return this.inventory.slots.some((item) => item && LURE_TYPES.has(item.type));
  }

  /** An item just picked up goes in, explained the first time. @param {Pickup} item */
  put(item) {
    this.inventory.add(item);
    const { hud } = this.deps;
    hud.toast(this.itemTips.has(item.type) ? `Picked up a ${item.type}` : ITEM_TIPS[item.type]);
    this.itemTips.add(item.type);
  }

  /**
   * The bag is full: the selected item goes down where the new one lay.
   * @param {Pickup} item @param {(item: Pickup) => void} pickUp takes the new item (into the slot just emptied)
   */
  swapFor(item, pickUp) {
    const { x, z } = item.mesh.position;
    const dropped = this.inventory.removeSelected();
    pickUp(item);
    this.deps.pickups.drop(dropped, { x, z });
  }

  /** @param {boolean} isHiding inside a locker you can pick a slot but not use or drop anything */
  handleInput(isHiding) {
    const { input } = this.deps;
    const inventory = this.inventory;
    SLOT_KEYS.forEach((code, index) => {
      if (input.wasPressed(code)) inventory.select(index);
    });
    if (input.wasPressed('WheelDown')) inventory.cycle(1);
    if (input.wasPressed('WheelUp')) inventory.cycle(-1);
    if (isHiding) return;
    if (input.wasPressed(...USE_KEYS)) this.useSelected();
    else if (input.wasPressed(DROP_KEY)) this.dropSelected();
  }

  /** A bottle, can or flare is thrown; a battery goes into the flashlight; a bandage heals. */
  useSelected() {
    const item = this.inventory.selectedItem;
    if (!item) return;
    if (item.type === PickupType.BATTERY) {
      this.useBattery();
      return;
    }
    if (item.type === PickupType.BANDAGE) {
      this.useBandage();
      return;
    }
    const { audio, camera, player } = this.deps;
    this.inventory.removeSelected();
    if (item.type === PickupType.FLARE) {
      this.flares.ignite(item);
      audio.flareIgnite();
    }
    this.throwing.throwFrom(item, camera, player.velocity);
    audio.whoosh();
  }

  useBattery() {
    const { flashlight, audio, hud } = this.deps;
    if (flashlight.battery >= FULL_BATTERY) {
      hud.toast('The flashlight is still full');
      return;
    }
    this.inventory.removeSelected();
    flashlight.recharge(BATTERY_RECHARGE);
    audio.click();
    hud.toast('Fresh battery in the flashlight');
  }

  useBandage() {
    const { audio, hud } = this.deps;
    if (!this.deps.heal(BANDAGE_HEAL)) {
      hud.toast('You are not hurt');
      return;
    }
    this.inventory.removeSelected();
    audio.bandage();
    hud.toast('You bind the wound');
  }

  /** Sets the selected item down just in front of the feet, freeing the slot. */
  dropSelected() {
    const item = this.inventory.removeSelected();
    if (!item) return;
    const { player, pickups, audio } = this.deps;
    const { position, yaw } = player;
    const point = { x: position.x - Math.sin(yaw) * DROP_AHEAD, z: position.z - Math.cos(yaw) * DROP_AHEAD };
    pickups.drop(item, point);
    audio.clank(DROP_VOLUME, item.mesh.position);
  }

  /** @param {number} dt */
  update(dt) {
    this.updateThrown(dt);
    this.updateFlares(dt);
  }

  /** A bottle or can lands with a noise that draws it away; a flare burns where it lands. */
  updateThrown(dt) {
    const { audio, monster, hud, pickups } = this.deps;
    const { impacts, rested } = this.throwing.update(dt);
    for (const impact of impacts) {
      if (impact.breaks) audio.shatter(impact.position);
      else audio.clank(Math.min(impact.speed / THROW_SPEED, 1), impact.position);
      if (!impact.isFirst) continue;
      if (monster.hearNoise(impact.position, THROWABLE[impact.item.type].noiseRadius, true)) {
        hud.toast('It heard that...');
      }
    }
    // A flare stays where it lands until it burns out; bottles that survived and cans can be picked up again.
    rested.filter((item) => item.type !== PickupType.FLARE).forEach((item) => pickups.putBack(item));
  }

  /** A burning flare keeps calling it over, and blinds it once if it comes close. */
  updateFlares(dt) {
    const { audio, monster, hud } = this.deps;
    const { lure } = this.flares.update(dt);
    if (lure) monster.hearNoise(lure, FLARE_LURE_RADIUS, true);
    audio.flareBurning(this.flares.position);
    if (monster.isDormant || monster.state === MonsterState.STUNNED || !this.flares.dazzles(monster.position)) return;
    monster.stun(FLARE_STUN);
    audio.growl(monster.position);
    hud.toast('The flare blinds it!');
  }
}
