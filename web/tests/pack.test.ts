import { describe, it, expect } from 'vitest';
import { CHUNK, chunkName, chunkPlan, hashName } from '../scripts/pack-lib';

describe('pack', () => {
  it('splits into ≤ CHUNK-sized pieces, last one short', () => {
    const plan = chunkPlan(130_862_112, CHUNK);
    expect(CHUNK).toBe(8 * 1024 * 1024); // the shipped size, pinned once
    expect(plan.length).toBe(Math.ceil(130_862_112 / CHUNK));
    expect(plan[plan.length - 1].bytes).toBe(130_862_112 - (plan.length - 1) * CHUNK);
  });
  it('names carry the hash and a .bin suffix', () => {
    expect(hashName('model', 'abcdef0123456789', '03.bin')).toBe('model.abcdef01.03.bin');
    expect(hashName('tokenizer', 'abcdef0123456789', 'json.bin')).toBe('tokenizer.abcdef01.json.bin');
  });
  it('chunk names carry the chunk size too, so a CHUNK change cannot alias', () => {
    const sha = 'abcdef0123456789'.padEnd(64, '0');
    expect(chunkName(sha, CHUNK, 0)).toBe(`model.abcdef01.c${CHUNK}.00.bin`);
    // same model, different chunking → different names, so a stale cache
    // entry can never be replayed into a differently-sized slot
    expect(chunkName(sha, 16 * 1024 * 1024, 0)).not.toBe(chunkName(sha, CHUNK, 0));
    // same chunking, different model → different names too
    expect(chunkName('f'.repeat(64), CHUNK, 0)).not.toBe(chunkName(sha, CHUNK, 0));
    expect(chunkName(sha, CHUNK, 11)).toBe(`model.abcdef01.c${CHUNK}.11.bin`);
  });
});
