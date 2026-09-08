// Pure overscan math for VirtualList, factored out so it's testable without a
// browser: render a few rows above and below the visible viewport so a fast
// scroll never flashes empty space before the next paint.
/** One distribution row's height, in px — the `.drow` rule's own line box
 *  (app.css: 12px monospace, 1.5 line-height, 2px padding). `VirtualList`
 *  positions rows by arithmetic rather than by layout, so this number and the
 *  CSS have to agree; both consumers (the compressor's distribution viewer
 *  and the observatory's readout table) render the same `.drow`. */
export const ROW_HEIGHT = 22;

/** The scroller's own height — about 13 rows, which is enough to see a
 *  distribution's shape without the list dominating the card. */
export const LIST_HEIGHT = 300;

export interface VisibleRange {
  first: number;
  last: number; // exclusive
}

export function visibleRange(scrollTop: number, rowHeight: number, height: number, rows: number): VisibleRange {
  if (rows <= 0) return { first: 0, last: 0 };
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - 5);
  const last = Math.min(rows, first + Math.ceil(height / rowHeight) + 10);
  return { first, last };
}
