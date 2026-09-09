// `web/_headers` (Cloudflare Pages / Netlify) and
// `tools/web/nginx-nanourl.conf` must express one identical policy: the app
// has to behave the same wherever it's served from. Cloudflare applies ALL
// matching rules and comma-joins duplicates, so without `! Cache-Control`,
// `/*`'s `no-cache` would prepend onto the immutable rules and serve
// content-hashed chunks must-revalidate instead of immutable, exactly the
// kind of drift a comment claiming "mirrors web/_headers" cannot catch.
//
// So the mirroring is enforced here as a test, not asserted as a comment.
/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { headersFor, nginxHeadersFor, parseHeadersFile, parseNginxConf, patternMatches } from '../scripts/headers-lib';
import { HEADERS_FILE, NGINX_CONF } from '../scripts/paths';

const rules = parseHeadersFile(readFileSync(HEADERS_FILE, 'utf8'));
const nginx = parseNginxConf(readFileSync(NGINX_CONF, 'utf8'));

const IMMUTABLE = 'public, max-age=31536000, immutable';

// One representative path per class of thing dist/ contains.
const PATHS = [
  '/',
  '/index.html',
  '/learn.html',
  '/model.html',
  '/bench.html',
  '/assets/index-D4tPqvHK.js',
  '/assets/index-BxLmn0Qz.css',
  '/assets/model.5e37aad1.c20971520.00.bin',
  '/assets/model.5e37aad1.c20971520.06.bin',
  '/assets/tokenizer.6e4f2b4f.json.bin',
  '/assets/urlcodec.7867d47b.wasm.bin',
  '/assets/urlcodec-mt.be6068c4.wasm.bin',
  '/assets/atlas.8c7e850b.bin',
  // The favicon is its own class: root-level, not `.html`, and deliberately
  // NOT content-hashed. The immutable rule, which is only ever correct for a
  // hashed name, must not reach it. Both configs get there through their
  // catch-alls today; this pins that they still agree if either grows a rule.
  '/assets/favicon.svg',
];

describe('_headers', () => {
  it('sets cross-origin isolation and hardening on every path', () => {
    for (const path of PATHS) {
      const h = headersFor(rules, path);
      expect(h['Cross-Origin-Opener-Policy'], path).toBe('same-origin');
      expect(h['Cross-Origin-Embedder-Policy'], path).toBe('require-corp');
      expect(h['X-Content-Type-Options'], path).toBe('nosniff');
      // no-referrer, not strict-origin: a compressed link lives in the
      // fragment, and the origin alone still says a visitor came from here.
      expect(h['Referrer-Policy'], path).toBe('no-referrer');
    }
  });

  it('gives content-hashed assets an immutable Cache-Control with NO no-cache joined onto it', () => {
    for (const path of PATHS.filter((p) => p.startsWith('/assets/'))) {
      expect(headersFor(rules, path)['Cache-Control'], path).toBe(IMMUTABLE);
    }
  });

  it('leaves HTML on no-cache so a deploy reaches a returning visitor', () => {
    for (const path of ['/', '/index.html', '/learn.html', '/model.html', '/bench.html']) {
      expect(headersFor(rules, path)['Cache-Control'], path).toBe('no-cache');
    }
  });

  it('the `!` clear is what does it — without it Cloudflare comma-joins', () => {
    // Same rules minus the `! Cache-Control` lines: this is the shape that
    // shipped, reproduced here so the regression is pinned rather than
    // described.
    const withoutClear = rules.map((r) => ({ ...r, unset: [] }));
    expect(headersFor(withoutClear, '/assets/model.5e37aad1.c20971520.00.bin')['Cache-Control']).toBe(`no-cache, ${IMMUTABLE}`);
  });

  it('matches Cloudflare path patterns the way Cloudflare does', () => {
    expect(patternMatches('/*', '/anything/at/all.html')).toBe(true);
    expect(patternMatches('/assets/*', '/assets/model.abc.00.bin')).toBe(true);
    expect(patternMatches('/assets/*', '/assets/deep/model.abc.00.bin')).toBe(true);
    expect(patternMatches('/assets/*', '/index.html')).toBe(false);
    expect(patternMatches('/assets/*', '/assets/index-D4tPqvHK.js')).toBe(true);
    expect(patternMatches('/assets/*', '/index.js')).toBe(false);
  });
});

describe('nginx-nanourl.conf mirrors _headers', () => {
  it('emits the identical header set for every representative path', () => {
    for (const path of PATHS) {
      expect(nginxHeadersFor(nginx, path), path).toEqual(headersFor(rules, path));
    }
  });

  it('requires TLS: port 80 only redirects, and the serving block listens on 443', () => {
    const conf = readFileSync(NGINX_CONF, 'utf8');
    expect(conf).toMatch(/listen\s+443\s+ssl/);
    expect(conf).toMatch(/ssl_certificate\s+\S+/);
    expect(conf).toMatch(/ssl_certificate_key\s+\S+/);
    expect(conf).toMatch(/return\s+30[18]\s+https:/);
    // the port-80 block must not have a root/try_files of its own: the app
    // must never be served over plain HTTP, where crypto.subtle is undefined
    const port80 = /server\s*\{[^}]*listen\s+80[^}]*\}/.exec(conf)?.[0] ?? '';
    expect(port80).not.toMatch(/try_files/);
    expect(port80).toMatch(/return\s+30[18]\s+https:/);
  });
});
