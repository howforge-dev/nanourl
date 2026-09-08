// The learn page's sections: stable id + title, in reading order.
//
// The id half is a public contract: the observatory deep-links to
// `/learn.html#coder`, `#viz` and friends, and `e2e/learn.smoke.spec.ts`
// checks every id here against the rendered headings. The NUMBER of a section
// is its position in this list and nothing else: `Section.svelte` renders it,
// `Toc.svelte` lists it and `Ref.svelte` links to it, so inserting or
// reordering a section renumbers every heading and every cross-reference at
// once. A hand-typed "section 7" anywhere in the prose is a defect.
export const SECTIONS = [
  ['idea', 'The whole idea in one paragraph'],
  ['bits', 'Why predictable means compressible'],
  ['whynotzip', 'Why not just zip it?'],
  ['tokens', "Tokens: the model's alphabet"],
  ['lm', 'What a language model actually is'],
  ['transformer', 'Inside the transformer'],
  ['coder', 'From probabilities to a short string'],
  ['lossless', "Why it's perfectly lossless"],
  ['origin', 'Where the model came from'],
  ['small', 'How the model fits in your browser'],
  ['limits', "What it's bad at"],
  ['viz', 'Reading the observatory'],
] as const satisfies readonly (readonly [id: string, title: string])[];

export const SECTION_IDS: readonly string[] = SECTIONS.map(([id]) => id);

export type SectionId = (typeof SECTIONS)[number][0];

/** 1-based position in reading order; the number a heading and a `Ref` show. */
export function sectionNumber(id: SectionId): number {
  const i = SECTIONS.findIndex(([sid]) => sid === id);
  if (i < 0) throw new Error(`unknown learn section: ${id}`);
  return i + 1;
}

export function sectionTitle(id: SectionId): string {
  const entry = SECTIONS.find(([sid]) => sid === id);
  if (!entry) throw new Error(`unknown learn section: ${id}`);
  return entry[1];
}
