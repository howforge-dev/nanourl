// Cloudflare Turnstile, loaded on demand: the script is fetched the first
// time a visitor asks for a short link, never on page load, and one widget is
// rendered per request, since a token is single-use and expires.
//
// The widget's frames and script carry the resource-policy headers
// cross-origin isolation requires, so a token arrives under the site's
// COEP: require-corp (checked in a browser, not assumed).

interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileOptions): string;
  remove(widgetId: string): void;
}

interface TurnstileOptions {
  sitekey: string;
  /** `interaction-only`: nothing is drawn unless the visitor has to act. */
  appearance?: 'always' | 'execute' | 'interaction-only';
  callback?: (token: string) => void;
  'error-callback'?: (code: string) => boolean | void;
  'expired-callback'?: () => void;
  'timeout-callback'?: () => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** `render=explicit`: the script must not scan the page for widgets of its
 *  own; the component says where and when. */
export const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let loading: Promise<TurnstileApi> | null = null;

/** The API object, loading the script once. A load that fails is forgotten,
 *  so the next click tries again rather than failing forever. */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TURNSTILE_SCRIPT;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile loaded without its API')));
    s.onerror = () => reject(new Error('the human check could not be loaded'));
    document.head.append(s);
  }).catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}

/**
 * One token: render a widget into `container`, resolve with the token it
 * issues, and remove the widget either way. Rejects with a message fit to
 * show when the widget reports an error, expires or times out.
 */
export async function challenge(container: HTMLElement, sitekey: string): Promise<string> {
  const api = await loadTurnstile();
  return new Promise<string>((resolve, reject) => {
    let id = '';
    const settle = (fn: () => void): void => {
      if (id) api.remove(id);
      fn();
    };
    id = api.render(container, {
      sitekey,
      appearance: 'interaction-only',
      callback: (token) => settle(() => resolve(token)),
      // `true` tells the widget the error is handled, so it does not retry
      // on its own behind a button that already shows the failure.
      'error-callback': (code) => {
        settle(() => reject(new Error(`the human check failed (${code}); try again`)));
        return true;
      },
      'expired-callback': () => settle(() => reject(new Error('the human check expired; try again'))),
      'timeout-callback': () => settle(() => reject(new Error('the human check timed out; try again'))),
    });
  });
}
