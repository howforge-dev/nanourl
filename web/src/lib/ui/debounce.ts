// Trailing-edge debounce, and the one interval the app types against.
//
// Three byte-identical copies of the function before, and — more to the point
// — three call sites with two different intervals and no reason given
// anywhere: the compressor's encode and decode fields waited 400 ms, the
// observatory 450. Nothing about the observatory's work is 50 ms more
// expensive to start; it is a copy that drifted.

/** Run `fn` once the caller has stopped calling for `ms`. */
export function debounce(fn: () => void, ms: number): () => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

/**
 * How long to wait after the last keystroke before running the model.
 *
 * Long enough that typing a URL does not queue an encode per character (each
 * one is a full forward pass per token), short enough that pausing mid-URL
 * still feels like the page is keeping up. Every URL input on the site uses
 * it, so the site responds at one speed.
 */
export const INPUT_DEBOUNCE_MS = 400;
