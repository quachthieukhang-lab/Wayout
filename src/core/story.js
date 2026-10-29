/**
 * Dr. Marrow's journal: one page is tied to each key of the emergency exit, so the story comes out key by key.
 * Page n is shown when the n-th key is picked up (whichever key it is), and stays readable in the pause menu.
 * @typedef {{ title: string, text: string }} StoryNote
 */

/** @type {readonly StoryNote[]} */
export const STORY_NOTES = Object.freeze([
  {
    title: 'Dr. E. Marrow — March 2, 1987',
    text:
      'The sleep study is going well. Nine patients who cannot dream. Compound M-9 lets them sleep for the first ' +
      'time in years. Subject 9 thanked me. He smiled the whole time.',
  },
  {
    title: 'March 19',
    text:
      'Subject 9 has not slept in eleven days. He does not tire. He sits facing the wall and smiles. The night ' +
      'nurses have asked to be moved. He is taller than he was. I am sure of it.',
  },
  {
    title: 'April 6 — Ward C',
    text:
      'I heard it from the stairwell: the nurses, then nothing. It does not see well. It listens. It found Nurse ' +
      'Hale by her footsteps. When my torch touched it, it turned toward the light.',
  },
  {
    title: 'April 7',
    text:
      'I have chained the main doors. The exit takes five keys, and I have hidden them where it walks; it has no use ' +
      'for keys. It cannot fit in the ducts. It does not open the lockers, unless it watched you climb in.',
  },
  {
    title: 'Undated',
    text:
      'If you are reading the last page, the exit is open, and it knows. It always knows when that door opens. ' +
      'Do not stop. Do not look back. Do not let it smile at you. — E.M.',
  },
]);
