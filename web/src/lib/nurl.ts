// int4-g64 dequantisation of a .nurl v3 artifact's 2D tensors, matching
// rust/urlcodec/src/model.rs's `QuantMat::row_f32` bit for bit: per row, per
// 64-column group, an f16 scale
// (2 bytes) then 32 bytes of packed nibbles — low nibble = even column,
// high nibble = odd column, value = (nibble - 7) * scale.
import { f16ToF32 } from './f16';

const GROUP = 64;
const GROUP_BYTES = 34; // f16 scale (2B) + 32 nibble bytes (v3 artifact)

/** Dequantise `rows` consecutive int4-g64 rows of width `d`, starting at byte
 * `offset` inside `model` (the raw .nurl bytes — e.g. `info.wpe_offset` for
 * the position table, or `info.wte_offset + row * (d/64*34)` for one wte
 * row). Returns a flat row-major Float32Array of length `rows * d`. */
export function dequantRows(model: Uint8Array, offset: number, rows: number, d: number): Float32Array {
  if (d % GROUP !== 0) throw new Error(`dequantRows: d=${d} is not a multiple of ${GROUP}`);
  const ng = d / GROUP;
  const out = new Float32Array(rows * d);
  const view = new DataView(model.buffer, model.byteOffset + offset, rows * ng * GROUP_BYTES);
  let o = 0;
  for (let r = 0; r < rows; r++) {
    for (let g = 0; g < ng; g++) {
      const scale = f16ToF32(view.getUint16(o, true));
      for (let k = 0; k < 32; k++) {
        const b = view.getUint8(o + 2 + k);
        out[r * d + g * GROUP + 2 * k] = ((b & 15) - 7) * scale;
        out[r * d + g * GROUP + 2 * k + 1] = ((b >> 4) - 7) * scale;
      }
      o += GROUP_BYTES;
    }
  }
  return out;
}

/** Byte length of one int4-g64 row of width `d` (34 bytes per 64-column
 * group) — the stride callers need to seek to an arbitrary wte row without
 * dequantising the rows before it. */
export const rowBytes = (d: number): number => (d / GROUP) * GROUP_BYTES;
