// The number fields' input handling, in one place, so every field clamps
// the same way and the one exception is a flag rather than a special case.
//
// Typing applies live only while the text is a number inside the bounds;
// anything else waits for blur or Enter (`change`), when `sanitize` clamps
// it. Clamping on every keystroke would rewrite "2" into the minimum before
// the user can type "240". An empty field is the one case that differs by
// field: for width, scale or margin it waits for blur too, or deleting the
// digits to retype would snap the default back in; for the version, empty
// MEANS auto, so it applies at once.
export interface BoundedOptions {
  /** Accept only whole numbers live (the default); off for 0..1 shares. */
  integer?: boolean;
  /** An empty field applies immediately as "auto" rather than waiting. */
  emptyIsAuto?: boolean;
}

export interface BoundedHandlers {
  oninput: (e: Event) => void;
  onchange: (e: Event) => void;
}

const fieldValue = (e: Event): string => (e.currentTarget as HTMLInputElement).value;

/** Handlers for one bounded field: `apply` receives the raw text (for
 *  `sanitize` to clamp) or the number when it is live-valid. */
export function bounded(apply: (value: string | number) => void, lo: number, hi: number, opts: BoundedOptions = {}): BoundedHandlers {
  const integer = opts.integer ?? true;
  return {
    oninput: (e) => {
      const v = fieldValue(e);
      if (v === '') {
        if (opts.emptyIsAuto) apply('');
        return;
      }
      const n = Number(v);
      if (Number.isFinite(n) && (!integer || Number.isInteger(n)) && n >= lo && n <= hi) apply(n);
    },
    onchange: (e) => apply(fieldValue(e)),
  };
}
