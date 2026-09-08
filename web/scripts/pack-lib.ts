// 8 MiB: Cloudflare's edge cache keeps assets up to somewhere between 5 and
// 20 MiB (a 5 MiB chunk hits on every request, a 20 MiB one never did), and
// the chunks are the bulk of every first visit.
export const CHUNK = 8 * 1024 * 1024;

export function chunkPlan(total: number, chunk = CHUNK) {
  const out: { index: number; offset: number; bytes: number }[] = [];
  for (let off = 0, i = 0; off < total; off += chunk, i++) out.push({ index: i, offset: off, bytes: Math.min(chunk, total - off) });
  return out;
}

export const hashName = (base: string, sha256: string, ext: string) => `${base}.${sha256.slice(0, 8)}.${ext}`;

/**
 * Name for one model chunk: the whole-model digest **and the chunk size**.
 *
 * Both axes have to be in the name. The model digest is what makes "chunk 3
 * from yesterday + chunk 4 from today" impossible — any weight change renames
 * every chunk together. The chunk size is the other axis: without it in the
 * name, retuning `CHUNK` from 20 MiB to 16 MiB with the model unchanged would
 * leave `model.<sha8>.00.bin` with its old name but a different length and
 * content. A returning visitor's Cache API entry would survive `pruneCache`
 * (its name is still in the manifest), get replayed with no length check, and
 * land 20 MiB wide in a 16 MiB slot — scrambled weights for returning
 * visitors, a fine site for everyone else. `loader.ts` independently
 * length-checks every cache read against the manifest, which catches the same
 * aliasing from the other side; the digest is checked once on download,
 * before anything is written to the cache, not on every read.
 */
export const chunkName = (modelSha256: string, chunkBytes: number, index: number) =>
  hashName('model', modelSha256, `c${chunkBytes}.${String(index).padStart(2, '0')}.bin`);
