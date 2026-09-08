/// <reference types="node" />
// The static server the Playwright suite runs against.
//
// It replaces `vite preview`, which injects its own COOP/COEP from
// vite.config.ts's `preview.headers`, so the entire response-header surface
// (cross-origin isolation, the immutable-vs-no-cache split) would be
// structurally untestable, and a dist/ shipped with no `_headers` at all
// would still pass every spec with the threads tier happily active.
//
// This serves `dist/_headers` (the file the build copied) through the same
// parser `web/tests/headers.test.ts` uses, so the suite exercises the
// real deploy policy and fails loudly if the build stopped shipping it.
//
// Deliberately tiny and dependency-free (node http + fs). It is not a
// production server: no compression, no ranges, no caching of its own.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg } from '../scripts/argv';
import { headersFor, parseHeadersFile } from '../scripts/headers-lib';
import { WEB_ROOT } from '../scripts/paths';
import { DEFAULT_PREVIEW_PORT } from './ports';

const port = Number(arg('--port', String(DEFAULT_PREVIEW_PORT)));
const root = resolve(WEB_ROOT, arg('--dir', 'dist'));
const headersPath = join(root, '_headers');

if (!existsSync(headersPath)) {
  console.error(
    `e2e/serve.ts: ${headersPath} is missing.\n` +
      `  vite.config.ts's copyHeaders plugin is what puts it there, so this means the build no longer\n` +
      `  ships the deploy headers — exactly the regression this server exists to make visible.`,
  );
  process.exit(1);
}
const rules = parseHeadersFile(readFileSync(headersPath, 'utf8'));

// Mirrors tools/web/nginx-nanourl.conf's two `default_type` locations plus the
// ordinary extensions dist/ contains. `.json.bin`/`.wasm.bin` are checked
// before `.bin` for the same reason nginx checks them first: the `.bin` suffix
// is there to stop CDNs keying off the extension, so the true type has to be
// restored explicitly.
function contentType(path: string): string {
  if (path.endsWith('.json.bin')) return 'application/json';
  if (path.endsWith('.wasm.bin')) return 'application/wasm';
  if (path.endsWith('.bin')) return 'application/octet-stream';
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.mjs': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.wasm': 'application/wasm',
      '.map': 'application/json',
    }[extname(path)] ?? 'application/octet-stream'
  );
}

/** nginx's `try_files $uri $uri/ =404`, and nothing more: there is no SPA
 *  fallback, so `/anything/bench.html` 404s here exactly as it does in
 *  production (client.ts's `?mtfail=handshake` gate depends on that). */
function resolveFile(urlPath: string): string | null {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const candidate = join(root, rel);
  if (!candidate.startsWith(root)) return null; // traversal
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  const asDir = join(candidate, 'index.html');
  if (existsSync(asDir) && statSync(asDir).isFile()) return asDir;
  return null;
}

const handler = (req: IncomingMessage, res: ServerResponse): void => {
  const urlPath = new URL(req.url ?? '/', `http://localhost:${port}`).pathname;
  const file = resolveFile(urlPath);
  // Header rules key off the request path, not the resolved file: that is
  // what a CDN does, and it is what makes `/` (an HTML page) land on the
  // no-cache rule rather than on whatever index.html's extension suggests.
  const headers: Record<string, string> = { ...headersFor(rules, urlPath) };
  if (!file) {
    res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }
  // Streamed, not readFileSync'd: the model chunks are 20 MiB each and every
  // spec loads all seven.
  const size = statSync(file).size;
  res.writeHead(200, { ...headers, 'Content-Type': contentType(file), 'Content-Length': String(size) });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
};
const server = createServer(handler);

/** Start the same server programmatically. `scripts/shots.ts` uses this so the
 *  screenshot harness renders against the real `_headers` policy (the same
 *  cross-origin isolation the suite asserts, and therefore the same kernel
 *  tier) instead of a second, weaker static server of its own. */
export function startServer(listenPort: number): Promise<Server> {
  return new Promise((ok) => {
    const s = createServer(handler);
    s.listen(listenPort, () => ok(s));
  });
}

// Only listen when run as a CLI (playwright.config.ts's webServer); importing
// this module must not bind a port.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(port, () => {
    console.log(`e2e/serve.ts: serving ${root} on http://localhost:${port} with ${headersPath}'s rules`);
  });
}
