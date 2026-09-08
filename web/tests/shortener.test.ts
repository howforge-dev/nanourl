import { describe, expect, it } from 'vitest';
import { SHORTEN_API, retryText, shorten } from '../src/lib/shortener';
import { SITE_URL } from '../src/lib/links';

const reply = (status: number, body: unknown, headers: Record<string, string> = {}): typeof fetch =>
  async () =>
    new Response(body === undefined ? '' : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });

const capture = (): { fetch: typeof fetch; calls: { url: string; init: RequestInit }[] } => {
  const calls: { url: string; init: RequestInit }[] = [];
  const f: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify({ ok: true, slug: 'ABC123', link: `${SITE_URL}ABC123` }), { status: 201 });
  };
  return { fetch: f, calls };
};

describe('shorten', () => {
  it('posts the URL as JSON to the canonical origin, with the token only when given', async () => {
    const c = capture();
    await shorten('https://example.com/x', '', c.fetch);
    await shorten('https://example.com/x', 'tok', c.fetch);
    expect(SHORTEN_API).toBe('https://qv.lc/api/new');
    expect(c.calls.map((x) => x.url)).toEqual([SHORTEN_API, SHORTEN_API]);
    expect(c.calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(c.calls[0].init.body))).toEqual({ url: 'https://example.com/x' });
    expect(JSON.parse(String(c.calls[1].init.body))).toEqual({ url: 'https://example.com/x', turnstile: 'tok' });
  });

  it('reads a new link from a 201 and an existing one from a 200, spelled in lowercase', async () => {
    const body = { ok: true, slug: 'ABC123', link: `${SITE_URL}ABC123` };
    expect(await shorten('u', '', reply(201, body))).toEqual({ ok: true, slug: 'abc123', link: `${SITE_URL}abc123`, created: true });
    expect(await shorten('u', '', reply(200, body))).toEqual({ ok: true, slug: 'abc123', link: `${SITE_URL}abc123`, created: false });
  });

  it('turns a rate limit into a wait in words, from Retry-After', async () => {
    const r = await shorten('u', '', reply(429, { ok: false, error: 'too many' }, { 'Retry-After': '600' }));
    expect(r).toEqual({ ok: false, error: 'too many short links from your address; try again in 10 minutes', retryAfterSeconds: 600 });
    const noHeader = await shorten('u', '', reply(429, { ok: false, error: 'too many' }));
    expect(noHeader.ok).toBe(false);
    expect((noHeader as { retryAfterSeconds?: number }).retryAfterSeconds).toBe(600);
  });

  it("shows the server's own words for a refusal, and the status when it has none", async () => {
    expect(await shorten('u', '', reply(400, { ok: false, error: 'not an http(s) URL this service will shorten' }))).toEqual({
      ok: false,
      error: 'not an http(s) URL this service will shorten',
    });
    expect(await shorten('u', '', reply(403, { ok: false, error: 'human check failed', codes: ['timeout-or-duplicate'] }))).toEqual({
      ok: false,
      error: 'human check failed',
    });
    expect(await shorten('u', '', reply(502, undefined))).toEqual({ ok: false, error: 'qv.lc answered 502' });
  });

  it('refuses a 2xx that is not a link on the site', async () => {
    expect(await shorten('u', '', reply(200, { ok: true, slug: 'X', link: 'https://evil.example/X' }))).toEqual({ ok: false, error: 'unexpected answer from qv.lc' });
    expect(await shorten('u', '', reply(200, { ok: true }))).toEqual({ ok: false, error: 'unexpected answer from qv.lc' });
    expect(await shorten('u', '', reply(200, undefined))).toEqual({ ok: false, error: 'unexpected answer from qv.lc' });
  });

  it('reports a failed connection in words', async () => {
    const down: typeof fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await shorten('u', '', down)).toEqual({ ok: false, error: 'could not reach qv.lc; check your connection and try again' });
  });
});

describe('retryText', () => {
  it('speaks seconds under a minute and a half, minutes above', () => {
    expect(retryText(0)).toBe('1 second');
    expect(retryText(45)).toBe('45 seconds');
    expect(retryText(89)).toBe('89 seconds');
    expect(retryText(90)).toBe('2 minutes');
    expect(retryText(600)).toBe('10 minutes');
  });
});
