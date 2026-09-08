// One parser for both header configs, so `web/_headers` (Cloudflare Pages /
// Netlify) and `tools/web/nginx-nanourl.conf` can be compared per path by a
// unit test instead of by eye; the two files must stay mirrors of each
// other. Also used by `e2e/serve.ts`, so the Playwright suite serves the
// real `_headers` policy rather than `vite preview`'s own injected
// COOP/COEP, which would leave the headers surface untestable.
//
// Deliberately dependency-free and text-only: it never runs nginx and never
// talks to Cloudflare, it reads what the two files say.

export interface HeaderRule {
  /** The path pattern as written, e.g. `/*`, `/*.bin`, `/assets/*`. */
  pattern: string;
  /** `Name: value` lines, in file order. */
  set: [string, string][];
  /** `! Name` lines: Cloudflare's documented way to clear a header a broader
   *  rule already set, instead of comma-joining onto it. */
  unset: string[];
}

const norm = (name: string) => name.toLowerCase();

/**
 * Parse a Cloudflare Pages / Netlify `_headers` file.
 *
 * Format: an unindented line starting with `/` opens a rule; indented lines
 * under it are either `Name: value` or `! Name`. `#` starts a comment.
 */
export function parseHeadersFile(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  let cur: HeaderRule | null = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    const indented = /^\s/.test(rawLine);
    if (!indented) {
      if (!line.startsWith('/')) throw new Error(`_headers: expected a path pattern starting with "/", got ${JSON.stringify(line)}`);
      cur = { pattern: line.trim(), set: [], unset: [] };
      rules.push(cur);
      continue;
    }
    if (!cur) throw new Error(`_headers: header line before any path pattern: ${JSON.stringify(line)}`);
    const body = line.trim();
    if (body.startsWith('!')) {
      cur.unset.push(norm(body.slice(1).trim()));
      continue;
    }
    const colon = body.indexOf(':');
    if (colon < 0) throw new Error(`_headers: expected "Name: value" or "! Name", got ${JSON.stringify(body)}`);
    cur.set.push([body.slice(0, colon).trim(), body.slice(colon + 1).trim()]);
  }
  return rules;
}

/** Cloudflare's path matching: `*` is a splat (matches `/` too), `:name`
 *  matches one path segment. Everything else is literal. */
export function patternMatches(pattern: string, path: string): boolean {
  const re = pattern
    .split('')
    .map((ch) => {
      if (ch === '*') return '.*';
      return ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('')
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '[^/]+');
  return new RegExp(`^${re}$`).test(path);
}

/**
 * Apply every matching rule in file order, the way Cloudflare Pages does:
 * **all** matching rules apply, and a header set twice is comma-joined, so
 * without `! Name`, `/*`'s `Cache-Control: no-cache` would end up prepended
 * to `/*.bin`'s `immutable` (RFC 9111 §5.2.2.4: `no-cache` is not cancelled
 * by `max-age` or `immutable`, so an "immutable cache for hashed chunks"
 * rule would not actually take effect). `! Name` clears what earlier rules
 * set, which is Cloudflare's documented remedy.
 */
export function headersFor(rules: HeaderRule[], path: string): Record<string, string> {
  const out = new Map<string, { name: string; value: string }>();
  for (const rule of rules) {
    if (!patternMatches(rule.pattern, path)) continue;
    for (const name of rule.unset) out.delete(name);
    for (const [name, value] of rule.set) {
      const key = norm(name);
      const prev = out.get(key);
      out.set(key, { name, value: prev ? `${prev.value}, ${value}` : value });
    }
  }
  return Object.fromEntries([...out.values()].map((h) => [h.name, h.value]));
}

// --- nginx ------------------------------------------------------------------

export interface NginxPolicy {
  /** `add_header Name value always;`: applied to every response. */
  addHeaders: [string, string][];
  /** The `map $uri $cache_control { ... }` table, in file order: `default` is
   *  the fallback, `~`-prefixed keys are regexes (`~*` = case-insensitive). */
  cacheMap: { key: string; value: string }[];
}

const unquote = (s: string) => s.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');

export function parseNginxConf(text: string): NginxPolicy {
  const stripped = text
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, '$1'))
    .join('\n');

  const addHeaders: [string, string][] = [];
  for (const m of stripped.matchAll(/^\s*add_header\s+(\S+)\s+([\s\S]*?);\s*$/gm)) {
    let value = m[2].trim().replace(/\s+/g, ' ');
    value = value.replace(/\s+always$/, '');
    addHeaders.push([m[1], unquote(value)]);
  }

  const mapBlock = /map\s+\$uri\s+\$cache_control\s*\{([\s\S]*?)\}/.exec(stripped);
  if (!mapBlock) throw new Error('nginx conf: no `map $uri $cache_control { ... }` block found');
  const cacheMap: { key: string; value: string }[] = [];
  for (const line of mapBlock[1].split('\n')) {
    const m = /^\s*(\S+)\s+(.*);\s*$/.exec(line);
    if (!m) continue;
    cacheMap.push({ key: m[1], value: unquote(m[2].trim()) });
  }
  if (!cacheMap.some((e) => e.key === 'default')) throw new Error('nginx conf: the $cache_control map has no `default`');
  return { addHeaders, cacheMap };
}

/** nginx's `map` semantics: the first matching non-`default` entry wins;
 *  `default` is used when nothing matches. */
export function nginxCacheControl(policy: NginxPolicy, path: string): string {
  for (const { key, value } of policy.cacheMap) {
    if (key === 'default') continue;
    if (key.startsWith('~')) {
      const ci = key.startsWith('~*');
      const re = new RegExp(key.slice(ci ? 2 : 1), ci ? 'i' : '');
      if (re.test(path)) return value;
    } else if (key === path) {
      return value;
    }
  }
  return policy.cacheMap.find((e) => e.key === 'default')!.value;
}

/** Every response header nginx sends for `path`, in the same shape
 *  `headersFor` returns, so the two configs can be compared directly. */
export function nginxHeadersFor(policy: NginxPolicy, path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of policy.addHeaders) {
    out[name] = value === '$cache_control' ? nginxCacheControl(policy, path) : value;
  }
  return out;
}
