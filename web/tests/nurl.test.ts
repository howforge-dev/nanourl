import { describe, it, expect } from 'vitest';
import { dequantRows, rowBytes } from '../src/lib/nurl';

describe('nurl dequant', () => {
  it('decodes one int4-g64 group with an f16 scale', () => {
    const buf = new Uint8Array(34);
    buf[0] = 0x00;
    buf[1] = 0x38; // f16 0.5 little-endian
    for (let k = 0; k < 32; k++) buf[2 + k] = (k % 16) | (((k + 1) % 16) << 4); // lo nibble = even index, hi = odd
    const out = dequantRows(buf, 0, 1, 64);
    expect(out).toHaveLength(64);
    expect(out[0]).toBeCloseTo((0 - 7) * 0.5);
    expect(out[1]).toBeCloseTo((1 - 7) * 0.5);
    expect(out[2]).toBeCloseTo((1 - 7) * 0.5);
  });

  it('reads a row at a nonzero offset, and multiple rows/groups', () => {
    const rowBuf = new Uint8Array(34);
    rowBuf[0] = 0x00;
    rowBuf[1] = 0x38;
    for (let k = 0; k < 32; k++) rowBuf[2 + k] = (k % 16) | (((k + 1) % 16) << 4);
    const model = new Uint8Array(10 + 34 * 3); // pad prefix + 3 groups (2 rows x d=64, + 1 leftover)
    model.set(rowBuf, 10);
    model.set(rowBuf, 10 + 34);
    const out = dequantRows(model, 10, 2, 64);
    expect(out).toHaveLength(128);
    expect(out[0]).toBeCloseTo(-3.5);
    expect(out[64]).toBeCloseTo(-3.5); // second row starts fresh
  });

  it('rejects a width that is not a multiple of the 64-group', () => {
    expect(() => dequantRows(new Uint8Array(34), 0, 1, 63)).toThrow();
  });

  it('rowBytes matches the 34-bytes-per-64-group layout', () => {
    expect(rowBytes(64)).toBe(34);
    expect(rowBytes(1280)).toBe(20 * 34); // our shipped model's d_model
  });
});
