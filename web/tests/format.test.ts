import { describe, it, expect } from 'vitest';
import {
  fmtBits,
  fmtBytes,
  fmtCount,
  fmtExact,
  fmtMiB,
  fmtMs,
  fmtPct,
  fmtRate,
  fmtSeconds,
  fmtShare,
  MIB,
  NBSP,
  oneDp,
  paramsM,
  probPct,
} from '../src/lib/format';
import { navFor, PAGES } from '../src/lib/pages';

const plain = (s: string) => s.replace(new RegExp(NBSP, 'g'), ' ');

describe('sizes', () => {
  it('uses one divisor and one unit label', () => {
    expect(MIB).toBe(1048576);
    // The shipped artifact's size must read identically everywhere it is
    // quoted (the learn page, the status line, the observatory's architecture
    // table), so the same division is never labelled "MiB" in one place and
    // "MB" in another.
    expect(plain(fmtBytes(130_862_112))).toBe('124.8 MiB');
    expect(plain(fmtMiB(124.8))).toBe('124.8 MiB');
    expect(plain(fmtMiB(497.4, 0))).toBe('497 MiB');
    expect(plain(fmtRate(19_084_083))).toBe('18.2 MiB/s');
  });
});

describe('fmtBits', () => {
  it('never rounds a real cost down to zero', () => {
    // A token that cost 0.02 bits did not cost nothing; "0.0 b" beside an
    // empty bar says it did.
    expect(plain(fmtBits(0.02))).toBe('<0.1 b');
    expect(plain(fmtBits(0.002, 2))).toBe('<0.01 b');
    expect(plain(fmtBits(0))).toBe('<0.1 b');
  });
  it('rounds to the requested precision above the floor', () => {
    expect(plain(fmtBits(9.567))).toBe('9.6 b');
    expect(plain(fmtBits(9.567, 2))).toBe('9.57 b');
    expect(plain(fmtBits(9.567, 1, 'bits'))).toBe('9.6 bits');
    // 'none' for the sites that set figure and unit in different type.
    expect(fmtBits(9.567, 1, 'none')).toBe('9.6');
    expect(fmtBits(0.02, 1, 'none')).toBe('<0.1');
  });
});

describe('fmtPct — one rendering for every distribution on the site', () => {
  it('is fixed-point where fixed-point still has digits', () => {
    expect(fmtPct(0.83612)).toBe('83.612%');
    expect(fmtPct(0.00001234, 16.3)).toBe('0.001%'); // exactly at the threshold
  });

  it('goes scientific below 0.001%, instead of printing 0.000%', () => {
    // `.toFixed(3)` in the observatory's readout table renders every one of
    // these as "0.000%", and most of a full-vocabulary table lives down here.
    expect(fmtPct(1.2e-7)).toBe('1.2×10⁻⁵%');
    expect(fmtPct(3.4e-10)).toBe('3.4×10⁻⁸%');
    expect(fmtPct(0)).toBe('0%');
  });

  it('prefers the bit cost when the probability itself has lost precision', () => {
    // `prob` arrives from the codec already rounded; `bits` (-log2 p) keeps
    // its resolution all the way down, so it is what the small branch uses.
    expect(fmtPct(0, 30)).toBe('9.3×10⁻⁸%');
    // ...and is ignored above the threshold, where `prob` is perfectly good.
    expect(fmtPct(0.5, 1)).toBe('50.000%');
  });

  it('uses superscript characters, not markup', () => {
    // The same string goes into a Svelte template, an {@html} fragment and a
    // plain tooltip; a <sup> element only works in the first.
    expect(fmtPct(1.2e-7)).not.toContain('<');
  });
});

describe('shares, times and counts', () => {
  it('renders a share of a whole without a scientific branch', () => {
    expect(fmtShare(0.1234)).toBe('12.3%');
    expect(fmtShare(0.1234, 2)).toBe('12.34%');
  });

  it('renders durations at the precision the caller measured', () => {
    expect(plain(fmtMs(9.5709, 3))).toBe('9.571 ms');
    expect(plain(fmtMs(122.6))).toBe('123 ms');
    expect(plain(fmtSeconds(310))).toBe('0.3 s');
    expect(fmtSeconds(64_000)).toBe('1:04');
  });

  it('abbreviates big counts and spells exact ones in one pinned locale', () => {
    expect(fmtCount(246_119_680)).toBe('246M');
    expect(fmtCount(4_919_922_944)).toBe('4.9B');
    expect(fmtCount(19_922_944_000)).toBe('20B'); // one decimal below 10 of a unit, none above
    expect(fmtCount(100_000)).toBe('100K');
    expect(fmtCount(512)).toBe('512');
    // Not the visitor's locale: the surrounding page is English either way.
    expect(fmtExact(8192)).toBe('8,192');
    expect(fmtExact(100_000)).toBe('100,000');
  });

  it('rounds a parameter count the one way the whole site quotes it', () => {
    expect(paramsM(246_119_680)).toBe('246M');
    expect(oneDp(9.5709)).toBe('9.6');
    expect(probPct(0.26)).toBe('83.5%');
  });
});

describe('navFor — one menu, same on every page', () => {
  it('lists every listed page in PAGES order on every page, marking the current one', () => {
    for (const p of PAGES) {
      if (p.unlisted) continue;
      const menu = navFor(p.id);
      expect(menu.map((l) => l.href)).toEqual(PAGES.filter((x) => !x.unlisted).map((x) => x.href));
      expect(menu.filter((l) => l.current).map((l) => l.href)).toEqual([p.href]);
    }
  });

  it('spells each destination one way, with no arrows in the labels', () => {
    for (const l of navFor('index')) expect(l.label).not.toMatch(/[←→]/);
    expect(navFor('model').find((l) => l.href === '/')?.label).toBe('home');
  });

  it('every href is a page the build actually emits', () => {
    const built = new Set(['/', '/model.html', '/learn.html', '/dream.html', '/bench.html']);
    for (const p of PAGES) expect(built, `${p.id}`).toContain(p.href);
  });
});
