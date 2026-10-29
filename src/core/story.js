/**
 * Dr. Marrow's journal, the tapes left on the wards, what is written on the walls, and the endings.
 * Journal pages are scattered over the hospital and optional: page n is shown when the n-th page is picked up
 * (whichever one it is), and how many were read decides the ending. Everything found stays in the pause menu's Notes.
 * @typedef {'page' | 'tape'} NoteKind
 * @typedef {{ title: string, text: string, kind?: NoteKind }} StoryNote
 * @typedef {'truth' | 'partial' | 'blind'} EndingName
 * @typedef {{ title: string, text: string }} Ending
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
    title: 'March 30',
    text:
      'The board wants results. I doubled the dose for all nine. Eight of them screamed through the night. ' +
      'Subject 9 only smiled, and asked me how I sleep.',
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
    title: 'April 9',
    text:
      'I took M-9 myself last night. I had to understand what it sees. I understand now. It is not hunting them. ' +
      'It never was. It is looking for the one who made it.',
  },
  {
    title: 'Undated',
    text:
      'There were nine beds on Ward C. My notes list ten patients. The tenth signature is mine. If the exit opens, ' +
      'it will know. Do not stop. Do not look back. Do not let it smile at you. — E.M.',
  },
]);

/** Recorded on the wards; the last one is always in Marrow's office. @type {readonly StoryNote[]} */
export const TAPES = Object.freeze([
  {
    kind: 'tape',
    title: 'Tape — Subject 9, interview',
    text:
      'MARROW: What do you see when you close your eyes? SUBJECT 9: Just the dark, doctor. It is very patient, ' +
      'the dark. MARROW: Patient? SUBJECT 9: It waits for someone to open the door.',
  },
  {
    kind: 'tape',
    title: 'Tape — Nurse Hale, April 5',
    text:
      'If anyone finds this: he is still giving them the injections. It does not come for the ones who stay quiet. ' +
      'Walk softly. Keep your light down. Please. Somebody come and get us out.',
  },
  {
    kind: 'tape',
    title: "Tape — Dr. Marrow's office",
    text:
      'This is Edwin Marrow. I am staying. Someone has to keep it inside, and it is listening for me, always for ' +
      'me. If it finds you instead... I am sorry. I am smiling. Why am I smiling?',
  },
]);

/** Scrawled across the hospital. Short: each must fit one wall panel. */
export const WALL_WRITINGS = Object.freeze([
  'RUN',
  'IT CAN HEAR YOU',
  'LIGHTS OFF',
  'NINE BEDS',
  'MARROW LIED',
  "DON'T SMILE",
  '5 KEYS',
  'M-9',
]);

/** Only on the walls of Marrow's office. */
export const OFFICE_WRITINGS = Object.freeze(['FORGIVE ME', 'SUBJECT 10', "I CAN'T SLEEP"]);

/** How the run ends depends on how much of the journal was read. @type {Readonly<Record<EndingName, Ending>>} */
export const ENDINGS = Object.freeze({
  truth: Object.freeze({
    title: 'THE WHOLE TRUTH',
    text:
      "You carry all of Marrow's journal into the dawn. Nine subjects, ten names, and the tenth was his own. " +
      'This time the papers will print it. Behind you, something is still looking for its doctor.',
  }),
  partial: Object.freeze({
    title: 'YOU ESCAPED',
    text:
      'You made it out with pieces of a story no one will believe. Whatever walks Ward C is still in there, and now ' +
      'you know it has a name.',
  }),
  blind: Object.freeze({
    title: 'YOU RAN',
    text:
      'You ran and never looked back. You never learned what it was, or why it smiled. Some nights you wake up, and ' +
      'you are smiling too.',
  }),
});

export const PARTIAL_ENDING_PAGES = 3; // pages read for the middle ending; all of them for the truth

/**
 * @param {number} pagesFound journal pages read this run
 * @param {number} totalPages pages in the hospital
 * @returns {EndingName}
 */
export function endingFor(pagesFound, totalPages) {
  if (totalPages > 0 && pagesFound >= totalPages) return 'truth';
  return pagesFound >= PARTIAL_ENDING_PAGES ? 'partial' : 'blind';
}
