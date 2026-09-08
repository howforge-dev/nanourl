// Unit tests for the shared UI primitives (src/lib/ui).
//
// Mounted with Svelte's own `mount`/`unmount` rather than a testing library:
// nothing here needs a query DSL, and adding a dependency to assert
// `querySelector` results would be a dependency for its own sake.
//
// What these pin is the primitive's CONTRACT: the variant/size/tone classes a
// caller selects behaviour with, the attributes it forwards, and the element
// it renders. A page that swaps `variant="ghost"` for `variant="primary"` is a
// visual decision; a primitive that silently stops emitting `data-testid` or
// `aria-pressed` is a broken contract that only an E2E timeout would find.
import { beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount, type Component, type Snippet } from 'svelte';
import Button from '../src/lib/ui/Button.svelte';
import Card from '../src/lib/ui/Card.svelte';
import Callout from '../src/lib/ui/Callout.svelte';
import Chip from '../src/lib/ui/Chip.svelte';
import FactsGrid from '../src/lib/ui/FactsGrid.svelte';
import ScrollBox from '../src/lib/ui/ScrollBox.svelte';
import Segmented from '../src/lib/ui/Segmented.svelte';
import TextField from '../src/lib/ui/TextField.svelte';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

/** Mount `component` with `props`, run `check`, then tear it down.
 *
 * Generic over the component's own prop type, so every call below is checked
 * against the real component: a renamed or retyped prop fails `pnpm check`
 * here rather than rendering nothing at runtime. */
function render<P extends Record<string, unknown>>(component: Component<P>, props: P, check: (el: HTMLElement) => void): void {
  const app = mount(component, { target: host, props });
  flushSync();
  try {
    check(host);
  } finally {
    void unmount(app);
  }
}

/** A children snippet rendering a fixed label, in the shape Svelte 5 passes
 *  snippets to a component (`(anchor) => …`). One cast, here: `Snippet` is a
 *  branded type only the compiler can mint, and the alternative is a fixture
 *  component file per test. */
function text(label: string): Snippet {
  const render = (anchor: Node): void => {
    anchor.parentNode?.insertBefore(document.createTextNode(label), anchor);
  };
  return render as unknown as Snippet;
}

describe('Button', () => {
  it('renders a <button> with the variant, size and tone classes a caller selected', () => {
    render(Button, { variant: 'primary', size: 'lg', tone: 'accent', children: text('go') }, (el) => {
      const b = el.querySelector('button');
      expect(b).not.toBeNull();
      expect(b?.className.split(' ')).toEqual(['btn', 'btn-primary', 'btn-lg', 'btn-tone-accent']);
      expect(b?.textContent).toBe('go');
    });
  });

  it('defaults to a secondary, medium, untoned button of type=button', () => {
    render(Button, { children: text('x') }, (el) => {
      const b = el.querySelector('button');
      // an untoned button carries no tone class at all, rather than a
      // `tone-default` that means "no tone"
      expect(b?.className.split(' ')).toEqual(['btn', 'btn-secondary', 'btn-md']);
      // Not `submit`: every button here sits in page markup that may one day
      // gain a <form> around it, and a default-submit button would navigate.
      expect(b?.getAttribute('type')).toBe('button');
    });
  });

  it('forwards disabled, title, aria-label, aria-pressed and data-testid', () => {
    render(Button, { disabled: true, title: 't', ariaLabel: 'a', pressed: true, testid: 'tid', children: text('x') }, (el) => {
      const b = el.querySelector('button');
      expect(b?.disabled).toBe(true);
      expect(b?.getAttribute('title')).toBe('t');
      expect(b?.getAttribute('aria-label')).toBe('a');
      expect(b?.getAttribute('aria-pressed')).toBe('true');
      // On the control itself, so a Playwright click lands on the button.
      expect(b?.getAttribute('data-testid')).toBe('tid');
    });
  });

  it('calls onclick', () => {
    let clicks = 0;
    render(Button, { onclick: () => (clicks += 1), children: text('x') }, (el) => {
      el.querySelector('button')?.click();
      expect(clicks).toBe(1);
    });
  });
});

describe('Chip', () => {
  it('is a <span> without an onclick and a <button> with one', () => {
    render(Chip, { children: text('label') }, (el) => {
      expect(el.querySelector('span.chip')).not.toBeNull();
      expect(el.querySelector('button')).toBeNull();
    });
    render(Chip, { onclick: () => {}, children: text('label') }, (el) => {
      expect(el.querySelector('button.chip')).not.toBeNull();
    });
  });

  it('carries its modifiers as classes and forwards aria-pressed and the testid', () => {
    render(Chip, { mono: true, pre: true, block: true, selected: true, muted: true, pressed: false, testid: 'c', onclick: () => {}, children: text('x') }, (el) => {
      const c = el.querySelector('.chip');
      expect(c?.className.split(' ')).toEqual(expect.arrayContaining(['chip', 'mono', 'pre', 'block', 'selected', 'muted']));
      expect(c?.getAttribute('aria-pressed')).toBe('false');
      expect(c?.getAttribute('data-testid')).toBe('c');
    });
  });

  it('keeps a caller class beside its own', () => {
    render(Chip, { class: 'tok', children: text('x') }, (el) => {
      expect(el.querySelector('.chip.tok')).not.toBeNull();
    });
  });
});

describe('Segmented', () => {
  const OPTS = [
    { value: 'Encode', label: 'Encode' },
    { value: 'Decode', label: 'Decode' },
  ];

  it('renders the tabs look as a real ARIA tablist wired to its panels', () => {
    render(Segmented, { options: OPTS, value: 'Encode', onchange: () => {} }, (el) => {
      const strip = el.querySelector('.seg');
      expect(strip?.getAttribute('role')).toBe('tablist');
      // the look IS the class: a caller repeating it renders `seg tabs tabs`.
      // Svelte's own scope hash is filtered out: it is not part of the
      // contract and changes with the file's contents.
      expect(strip?.className.trim().split(/\s+/).filter((c) => !c.startsWith('svelte-'))).toEqual(['seg', 'tabs']);
      const tabs = [...el.querySelectorAll('[role=tab]')];
      expect(tabs.map((t) => t.id)).toEqual(['tab-Encode', 'tab-Decode']);
      expect(tabs.map((t) => t.getAttribute('aria-controls'))).toEqual(['panel-Encode', 'panel-Decode']);
      expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false']);
      // roving tabindex: only the selected tab is in the tab order
      expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1']);
    });
  });

  it('renders the switch look as a named group of toggles, not a tablist', () => {
    render(Segmented, { options: OPTS, value: 'Decode', onchange: () => {}, look: 'switch', label: 'output alphabet' }, (el) => {
      const strip = el.querySelector('.seg');
      expect(strip?.getAttribute('role')).toBe('group');
      expect(strip?.getAttribute('aria-label')).toBe('output alphabet');
      const buttons = [...el.querySelectorAll('button')];
      // aria-pressed, not aria-selected: nothing here swaps a panel.
      expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
      expect(buttons.every((b) => b.getAttribute('role') === null)).toBe(true);
    });
  });

  it('gives its options the shared button chrome rather than a copy of it', () => {
    render(Segmented, { options: OPTS, value: 'Encode', onchange: () => {} }, (el) => {
      for (const b of el.querySelectorAll('button')) {
        expect(b.classList.contains('btn'), 'a segmented option is a button like every other').toBe(true);
      }
    });
  });

  it('marks the selected option with a class as well as with ARIA', () => {
    render(Segmented, { options: OPTS, value: 'Decode', onchange: () => {} }, (el) => {
      expect(el.querySelector('button.on')?.textContent).toBe('Decode');
    });
  });

  it('reports the clicked option', () => {
    const seen: string[] = [];
    render(Segmented, { options: OPTS, value: 'Encode', onchange: (v: string) => seen.push(v) }, (el) => {
      el.querySelectorAll('button')[1].click();
      expect(seen).toEqual(['Decode']);
    });
  });
});

describe('TextField', () => {
  it('renders an <input> by default and a <textarea> when multiline', () => {
    render(TextField, { value: '' }, (el) => {
      expect(el.querySelector('input.field')?.getAttribute('type')).toBe('text');
      expect(el.querySelector('textarea')).toBeNull();
    });
    render(TextField, { value: '', multiline: true, rows: 2 }, (el) => {
      const ta = el.querySelector('textarea.field');
      expect(ta).not.toBeNull();
      expect(ta?.getAttribute('rows')).toBe('2');
    });
  });

  it('forwards the accessible name, placeholder, type and numeric bounds', () => {
    render(TextField, { value: 3, type: 'number', min: 1, max: 200, step: 1, ariaLabel: 'how many' }, (el) => {
      const i = el.querySelector('input');
      expect(i?.getAttribute('type')).toBe('number');
      expect(i?.getAttribute('min')).toBe('1');
      expect(i?.getAttribute('max')).toBe('200');
      expect(i?.getAttribute('step')).toBe('1');
      // an accessible name, not a placeholder standing in for one
      expect(i?.getAttribute('aria-label')).toBe('how many');
    });
  });

  it('is monospace by default and proportional with `sans`', () => {
    render(TextField, { value: '', sans: true }, (el) => {
      expect(el.querySelector('input')?.classList.contains('sans')).toBe(true);
    });
    render(TextField, { value: '' }, (el) => {
      expect(el.querySelector('input')?.classList.contains('sans')).toBe(false);
    });
  });
});

describe('Card, ScrollBox, Callout, FactsGrid', () => {
  it('Card emits .card and forwards the tab-panel attributes it is given', () => {
    render(Card, { id: 'panel-Encode', role: 'tabpanel', ariaLabelledby: 'tab-Encode', testid: 'pane-encode', flash: true, children: text('body') }, (el) => {
      const c = el.querySelector('div.card');
      expect(c?.classList.contains('flash')).toBe(true);
      expect(c?.id).toBe('panel-Encode');
      expect(c?.getAttribute('role')).toBe('tabpanel');
      expect(c?.getAttribute('aria-labelledby')).toBe('tab-Encode');
      expect(c?.getAttribute('data-testid')).toBe('pane-encode');
    });
  });

  it('ScrollBox emits the shared .scroller class plus any caller class', () => {
    render(ScrollBox, { class: 'fpwrap', children: text('wide') }, (el) => {
      const s = el.querySelector('div.scroller');
      expect(s?.classList.contains('fpwrap')).toBe(true);
      expect(s?.textContent).toBe('wide');
    });
  });

  it('Callout carries the warn modifier only when asked', () => {
    render(Callout, { children: text('note') }, (el) => {
      expect(el.querySelector('.callout')?.classList.contains('warn')).toBe(false);
    });
    render(Callout, { tone: 'warn', children: text('note') }, (el) => {
      expect(el.querySelector('.callout')?.classList.contains('warn')).toBe(true);
    });
  });

  it('FactsGrid wraps a titled group and renders bare without a title', () => {
    render(FactsGrid, { title: 'Cost', children: text('rows') }, (el) => {
      expect(el.querySelector('.fgroup > h4')?.textContent).toBe('Cost');
      expect(el.querySelector('.fgroup > dl.facts')).not.toBeNull();
    });
    render(FactsGrid, { children: text('rows') }, (el) => {
      expect(el.querySelector('.fgroup')).toBeNull();
      expect(el.querySelector('dl.facts')).not.toBeNull();
    });
  });
});
