// The online short link: `POST /api/new` on the site's origin, answered by
// `php/index.php`, and the words the page shows for each way it can fail.
//
// A short link is the one thing on the site that is stored rather than
// computed, so nothing here runs on its own: `shorten` is called once per
// click, never per keystroke, since the server limits creations per address.
import { SITE_URL } from './links';

/** Where a link is made. Always the canonical origin, whatever origin the
 *  page is served from, so a link minted on a mirror is still a qv.lc link. */
export const SHORTEN_API = new URL('api/new', SITE_URL).href;

/** The Turnstile widget's public key, the pair of the server's
 *  `turnstile_secret`. Empty when the server runs without the check, and the
 *  button then posts with no token. */
export const TURNSTILE_SITE_KEY = '0x4AAAAAAEtA2FJPUS8Ilu4K';

export interface Shortened {
  ok: true;
  slug: string;
  link: string;
  /** false when the URL already had a link, which is then the same link. */
  created: boolean;
}

export interface ShortenFailure {
  ok: false;
  /** Plain words for the visitor, never a status code alone. */
  error: string;
  /** Set on a rate-limit refusal: when the address may try again. */
  retryAfterSeconds?: number;
}

export type ShortenResult = Shortened | ShortenFailure;

/** "45 seconds" or "8 minutes": how long a refused visitor is told to wait. */
export function retryText(seconds: number): string {
  const count = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (seconds < 90) return count(Math.max(1, Math.round(seconds)), 'second');
  return count(Math.round(seconds / 60), 'minute');
}

const UNREACHABLE = 'could not reach qv.lc; check your connection and try again';

/**
 * Make (or find) the short link for `url`. `turnstile` is the widget's token
 * when the server requires one. Resolves to a failure rather than throwing:
 * every outcome is something to show under the button.
 */
export async function shorten(url: string, turnstile = '', fetchImpl: typeof fetch = fetch): Promise<ShortenResult> {
  let res: Response;
  try {
    res = await fetchImpl(SHORTEN_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(turnstile ? { url, turnstile } : { url }),
    });
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
  const body: unknown = await res.json().catch(() => null);
  const field = (k: string): unknown => (body && typeof body === 'object' ? (body as Record<string, unknown>)[k] : undefined);
  const serverError = typeof field('error') === 'string' ? (field('error') as string) : '';

  if (res.status === 429) {
    const header = Number(res.headers.get('Retry-After'));
    const seconds = Number.isFinite(header) && header > 0 ? header : 600;
    return { ok: false, error: `too many short links from your address; try again in ${retryText(seconds)}`, retryAfterSeconds: seconds };
  }
  if (!res.ok) {
    return { ok: false, error: serverError || `qv.lc answered ${res.status}` };
  }
  const slug = field('slug');
  const link = field('link');
  if (field('ok') !== true || typeof slug !== 'string' || !slug || typeof link !== 'string' || !link.startsWith(SITE_URL)) {
    return { ok: false, error: 'unexpected answer from qv.lc' };
  }
  return { ok: true, slug, link, created: res.status === 201 };
}
