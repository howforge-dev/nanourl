// The one entry-HTML template. Every page's `<id>.html` is generated from
// this plus its row in `src/lib/pages.ts`; none of them is checked in.
//
// Five hand-written entry files state a page's <head> in a second place, and
// a build-time rewrite that fills them in from the page record is a third —
// one that `pnpm dev`, or any build that skips the plugin, does not apply. The
// page record is the only declaration: this renders the file, and
// `vite.config.ts`'s `pages()` plugin writes it and derives the build's entry
// list from the same list.
import { pageEntryModule, pageMeta, pageWidth, type PageId } from '../src/lib/pages';

/** Escapes text for an HTML text node or a double-quoted attribute value.
 *  Titles and descriptions are ours, not user input, but a template that
 *  interpolates raw strings is a template that will eventually be handed one
 *  that is not. */
const esc = (t: string): string =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The complete entry document for one page. */
export function renderPage(id: PageId): string {
  const m = pageMeta(id);
  const width = pageWidth(id);
  // `wide` only: the default column needs no class, so a page that says
  // nothing about its width also carries nothing in its markup.
  const bodyClass = width === 'wide' ? ' class="wide"' : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.title)}</title>
<meta name="description" content="${esc(m.description)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(m.title)}">
<meta property="og:description" content="${esc(m.description)}">
<meta name="twitter:card" content="summary">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body${bodyClass}><div id="app"></div><script type="module" src="${pageEntryModule(id)}"></script></body>
</html>
`;
}
