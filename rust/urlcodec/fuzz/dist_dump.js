// Wasm-side counterpart of `urlcodec dist`: full-vocab codec_dist JSON, one
// line per URL, in the same order and format. fuzz/dist_compare.py diffs the
// two. With W > 0 the file must be urlcodec-mt.wasm and W workers are parked
// first, so tier 3 can be compared value by value as well.
//   node fuzz/dist_dump.js <wasm> <model.nurl> <tokenizer.json> <urls.txt> <n> <k> [W]
const fs = require('fs');
const { initCodec, spawnWorkers } = require('./driver_common.js');

const [wasmPath, modelPath, tokPath, urlsPath, nArg, kArg, wArg] = process.argv.slice(2);
const N = Number(nArg || 20), K = Number(kArg || 5), W = Number(wArg || 0);

function dump(w, mem) {
  const { put, readPacked } = initCodec(w, mem, modelPath, tokPath, W, false);
  const urls = fs.readFileSync(urlsPath, 'utf8').split('\n').filter(Boolean).slice(0, N);
  for (const url of urls) {
    const [up, ul] = put(Buffer.from(url, 'utf8'));
    const j = readPacked(w.codec_dist(up, ul, K, 0));
    w.ufree(up, ul);
    process.stdout.write(j + '\n');
  }
}

(async () => {
  if (W === 0) {
    const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {});
    dump(instance.exports, instance.exports.memory);
    return;
  }
  const memory = new WebAssembly.Memory({ initial: 4096, maximum: 16384, shared: true });
  const mod = new WebAssembly.Module(fs.readFileSync(wasmPath));
  const inst = new WebAssembly.Instance(mod, { env: { memory } });
  spawnWorkers(inst.exports, memory, mod, W);
  dump(inst.exports, memory);
})();
