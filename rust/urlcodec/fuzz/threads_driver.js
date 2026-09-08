// Tier-3 (threaded) side of the cross-runtime fuzz harness: instantiate
// urlcodec-mt.wasm with W compute workers over one shared memory, then run
// exactly the fuzz loop driver.js runs (both call driver_common.runFuzz) and
// print the same TSV. Byte-parity with the native/simd/relaxed TSVs is the
// pass condition: rows are owned whole by one participant, so any W must
// reproduce the single-thread bits.
//
// The mt module imports its memory (env.memory, shared), so the memory object
// is created here and handed to every instance. `maximum` must match the
// build's --max-memory link arg (1 GiB).
//
// spawnWorkers spawns ids 1..=W and blocks until threads_ready() (a true
// COUNT of registered workers) equals W, which is the contract codec_init
// enforces (rc 4 otherwise).
//
// Anything that faults the tier afterwards POISONS this instance: every
// codec_* call returns {"ok":false,"code":"instance_poisoned",...} and
// codec_init returns 6 for any W. Only codec_info keeps answering, so the
// reason is still readable. A driver that wants to carry on must build a new
// module, new workers and a new WebAssembly.Memory: there is no in-place
// recovery, because Worker.terminate() cannot be awaited and a lost worker
// may still be finishing a block in this memory. This harness does not
// retry: a poisoned run is a gate failure and should look like one.
//
//   node threads_driver.js <urlcodec-mt.wasm> <model.nurl> <tokenizer.json> <n> <seed> <W> [shard] [shards]
const fs = require('fs');
const { spawnWorkers, runFuzz } = require('./driver_common.js');

const [wasmPath, modelPath, tokPath, nArg, seedArg, wArg, shardArg, shardsArg] =
  process.argv.slice(2);
const W = Number(wArg || 4);

const memory = new WebAssembly.Memory({ initial: 4096, maximum: 16384, shared: true }); // 256 MiB .. 1 GiB
const mod = new WebAssembly.Module(fs.readFileSync(wasmPath));
const inst = new WebAssembly.Instance(mod, { env: { memory } });
const w = inst.exports;

spawnWorkers(w, memory, mod, W);
runFuzz(w, memory, {
  modelPath, tokPath,
  n: nArg || 500, seed: seedArg || 1, threads: W,
  shard: shardArg || 0, shards: shardsArg || 1,
});
