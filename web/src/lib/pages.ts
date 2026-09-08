// The site's pages, and how they refer to each other. This list is the only
// declaration of a page: `PageHeader` renders the menu and the wordmark suffix
// from it, `scripts/page-html.ts` renders the entry document's <head> and body
// class from it, and `vite.config.ts` derives the build's entry list from it.
//
// A page therefore says once what it is called on its own header (`suffix`),
// what other pages call it (`nav`), how wide its column is (`width`) and where
// it lives — and no two of those can disagree.

export type PageId = 'index' | 'model' | 'learn' | 'dream' | 'bench';

export interface PageDef {
  id: PageId;
  href: string;
  /** How OTHER pages link to this one. Every label says what the destination
   *  does, not what it is called — "model observatory", "how it works",
   *  "dream URLs" — and "home" for the compressor, which is the site itself. `← nanourl` named the
   *  site rather than the page, two lines under a wordmark already reading
   *  "nanourl". */
  nav: string;
  /** What follows the wordmark on this page's own header — the page's name. */
  suffix?: string;
  /** One line on what the page is, shown under the wordmark and used as the
   *  document title and meta description (scripts/page-html.ts renders both
   *  from it), so the header and the <head> cannot disagree. */
  tagline?: string;
  /** A page reached directly and linked from nowhere — it neither appears in
   *  the menu nor carries one. Nothing is unlisted today. */
  unlisted?: boolean;
  /** How wide this page's column is.
   *
   *  `text` (the default) is the reading measure: prose, a form, a result.
   *  `wide` is for a page whose content is canvases and tables rather than
   *  sentences — the observatory's residual heatmap sits at full resolution
   *  beside its norms chart only if the column is wider than a paragraph
   *  should ever be.
   *
   *  A page never spells a pixel value: the build puts this class on <body>
   *  and app.css resolves it to `--col`. */
  width?: 'text' | 'wide';
}

/** Reading order: the compressor first (it is the back-link target for every
 *  other page), then the explanatory pages and the kernel benchmark in the
 *  order the compressor offers them. `PageHeader` walks this list, which is why the order here is
 *  the order on screen. */
export const PAGES: readonly PageDef[] = [
  { id: 'index', href: '/', nav: 'home', suffix: 'offline URL shortener' },
  { id: 'model', href: '/model.html', nav: 'observatory', suffix: 'observatory', tagline: 'inspect the weights and predictions behind the compressor', width: 'wide' },
  { id: 'learn', href: '/learn.html', nav: 'how it works', suffix: 'how it works', tagline: 'a from-scratch explanation that assumes no machine-learning background' },
  { id: 'dream', href: '/dream.html', nav: 'dream', suffix: 'dream', tagline: 'the model run backwards, one imagined URL at a time' },
  { id: 'bench', href: '/bench.html', nav: 'benchmark', suffix: 'bench', tagline: 'a kernel benchmark that times every wasm tier on this device' },
];

const page = (id: PageId): PageDef => {
  const p = PAGES.find((x) => x.id === id);
  if (!p) throw new Error(`unknown page id: ${id}`);
  return p;
};

export const pageSuffix = (id: PageId): string | undefined => page(id).suffix;

/** One entry of the page menu. */
export interface NavLink {
  href: string;
  label: string;
  /** the page being viewed — rendered as the selected item, not a link */
  current: boolean;
}

/**
 * The page menu for `here`: every listed page in `PAGES` order, the current
 * one marked. The same menu on every page, in the same order, so a visitor
 * learns it once — no per-page back-links, no arrows.
 */
export function navFor(here: PageId): NavLink[] {
  if (page(here).unlisted) return [];
  return PAGES.filter((p) => !p.unlisted).map((p) => ({ href: p.href, label: p.nav, current: p.id === here }));
}

export const pageTagline = (id: PageId): string | undefined => page(id).tagline;

/** Document title: the site name, the page name, then the tagline if the
 *  page has one — the same words the header shows. */
export function pageTitle(id: PageId): string {
  const p = page(id);
  const name = p.suffix ? `nanourl · ${p.suffix}` : 'nanourl';
  return p.tagline ? `${name} — ${p.tagline}` : name;
}

/** The <head> facts for a page, from the same record as its header. */
export function pageMeta(id: PageId): { title: string; description: string; url: string } {
  const p = page(id);
  return { title: pageTitle(id), description: p.tagline ?? p.suffix ?? 'nanourl', url: p.href };
}

export const pageWidth = (id: PageId): 'text' | 'wide' => page(id).width ?? 'text';

/** The entry HTML the build generates for a page, relative to `web/`. The
 *  compressor's is `index.html` because that is the name a static host serves
 *  at `/`, which is the compressor's own href. */
export const pageHtmlFile = (id: PageId): string => `${id}.html`;

/** The page module the entry HTML loads. One directory per page, always
 *  named after the page: adding a page is a row above plus this directory. */
export const pageEntryModule = (id: PageId): string => `/src/pages/${id}/main.ts`;
