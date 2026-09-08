import { describe, expect, it } from 'vitest';
import { PAGES, pageEntryModule, pageHtmlFile, pageMeta, pageTitle, pageWidth } from '../src/lib/pages';
import { renderPage } from '../scripts/page-html';

describe('page titles and meta come from the one page record', () => {
  it('the compressor is named like any other page, with no tagline', () => {
    expect(pageTitle('index')).toBe('nanourl · offline URL shortener');
    expect(pageMeta('index').description).toBe('offline URL shortener');
  });
  it('every page with a tagline names itself before it', () => {
    for (const p of PAGES) {
      if (!p.tagline) continue;
      expect(pageTitle(p.id)).toBe(`nanourl · ${p.suffix} — ${p.tagline}`);
      expect(pageMeta(p.id).description).toBe(p.tagline);
    }
  });
});

describe('the entry HTML is generated from that same record', () => {
  it('names one file and one page module per page', () => {
    expect(pageHtmlFile('index')).toBe('index.html');
    expect(pageEntryModule('model')).toBe('/src/pages/model/main.ts');
  });

  it('puts the record’s title and description in the head, and og/twitter with them', () => {
    for (const p of PAGES) {
      const html = renderPage(p.id);
      const m = pageMeta(p.id);
      expect(html).toContain(`<title>${m.title}</title>`);
      expect(html).toContain(`<meta name="description" content="${m.description}">`);
      expect(html).toContain(`<meta property="og:title" content="${m.title}">`);
      expect(html).toContain(`<meta property="og:description" content="${m.description}">`);
    }
  });

  it('loads that page’s module and nothing else', () => {
    for (const p of PAGES) {
      const html = renderPage(p.id);
      expect(html).toContain(`src="${pageEntryModule(p.id)}"`);
      expect(html.match(/<script /g)?.length).toBe(1);
    }
  });

  it('links the favicon as a file — never a data: URI', () => {
    for (const p of PAGES) {
      expect(renderPage(p.id)).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
      expect(renderPage(p.id)).not.toContain('data:image');
    }
  });

  it('carries the column width as a body class, never as a pixel value', () => {
    for (const p of PAGES) {
      const html = renderPage(p.id);
      expect(html).toContain(pageWidth(p.id) === 'wide' ? '<body class="wide">' : '<body>');
      expect(html).not.toMatch(/\d+px/);
    }
  });

  it('escapes the record’s text rather than interpolating it raw', () => {
    // Titles are ours, not user input; a template that interpolates raw
    // strings is one that will eventually be handed a string that is not.
    const html = renderPage('bench');
    const body = html.slice(html.indexOf('<title>'));
    expect(body).not.toMatch(/content="[^"]*&(?!amp;|lt;|gt;|quot;)/);
  });
});
