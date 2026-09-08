// Trailing-edge debounce, and the one interval the app types against.
//
// One function and one interval, because nothing about the observatory's work
// is more expensive to start than the compressor's: a second value would only
// be a copy that drifted.

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
