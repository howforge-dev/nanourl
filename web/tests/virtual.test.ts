import { describe, it, expect } from 'vitest';
import { ROW_HEIGHT, visibleRange } from '../src/lib/ui/virtual';

describe('visibleRange', () => {
  it('overscans -5/+10 around the viewport', () => {
    // 5 rows visible; at the top, overscan above clamps at 0. Sized from
    // ROW_HEIGHT, not a hardcoded 22, so it can't drift from the real row height.
    expect(visibleRange(0, ROW_HEIGHT, 5 * ROW_HEIGHT, 1000)).toEqual({ first: 0, last: 15 });
    // scrolled 10 rows down: 5 rows above clamp off, 10 below extend past view.
    expect(visibleRange(10 * ROW_HEIGHT, ROW_HEIGHT, 5 * ROW_HEIGHT, 1000)).toEqual({ first: 5, last: 20 });
  });

  it('clamps last to the row count', () => {
    expect(visibleRange(0, ROW_HEIGHT, 5 * ROW_HEIGHT, 12)).toEqual({ first: 0, last: 12 });
  });

  it('is empty when there are no rows', () => {
    expect(visibleRange(0, ROW_HEIGHT, 5 * ROW_HEIGHT, 0)).toEqual({ first: 0, last: 0 });
  });
});
