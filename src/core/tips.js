/**
 * What the run looked like when it caught the player, for a tip that fits the death.
 * @typedef {{
 *   spottedBy: 'sight' | 'hearing' | null, wasLit: boolean, wasSprinting: boolean, sawHiding: boolean,
 *   hadLure: boolean, couldFlash: boolean, struggle: number
 * }} DeathContext `struggle` 0..1: how far the player got breaking free; `hadLure` a bottle, can or flare in the bag
 */

const GENERAL_TIPS = Object.freeze([
  'It cannot follow you into a vent. Crouch (C) and crawl through.',
  'A locker hides you completely, as long as it does not watch you climb in.',
  'Closing a door behind you slows it down: it has to force it open.',
  'The eye at the top of the screen fills before it charges. Back off while it is still a question mark.',
  'A radio lures it across the hospital for a few seconds. Switch one on and go the other way.',
]);

/**
 * The most useful lesson from how the player died, or a general tip.
 * @param {DeathContext} context
 * @param {() => number} [rng] picks the general tip
 * @returns {string}
 */
export function deathTip(context, rng = Math.random) {
  if (context.sawHiding) return 'It watched you climb into that locker. Hide before it sees you, not after.';
  if (context.spottedBy === 'hearing' && context.wasSprinting) {
    return 'It heard you running. Walk quietly (Z) or crouch (C) when it is near.';
  }
  if (context.spottedBy === 'sight' && context.wasLit) {
    return 'A lit flashlight shows you from far away. Turn it off (F) when you hear it coming.';
  }
  if (context.struggle < 0.5) return 'When it grabs you, mash Space as fast as you can to break free.';
  if (context.hadLure) return 'You still had something to throw. Throw it (G) away from you to lure it off.';
  if (context.couldFlash) return 'Flash it with Q as it closes in: the burst of light stuns it.';
  return GENERAL_TIPS[Math.floor(rng() * GENERAL_TIPS.length)];
}
