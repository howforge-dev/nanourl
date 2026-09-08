// The learn page's sections: stable id + title, in reading order.
//
// The id half is a public contract — the observatory deep-links to
// `/learn.html#coder`, `#viz` and friends — and it was written out twice: here
// (as `Toc.svelte`'s own array) and again in `e2e/learn.smoke.spec.ts`. The
// spec then asserted `toHaveCount(SECTION_IDS.length)` against its *own* copy,
// so renaming a section in the TOC and its `<Section id=…>` without touching
// the spec left the spec asserting nothing about the new id while still
// reporting green — the same self-consistent-and-blind shape the specs already
// guard against elsewhere.
//
// The `<Section>` elements themselves still spell their own `id` in App.svelte
// markup; this list is what the TOC renders and what the E2E checks against,
// so a section whose markup id drifts from this list now fails the spec.
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
