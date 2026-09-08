// Wasm side of the cross-runtime fuzz harness, single-threaded tiers (1 and
// 2). Emits lines in the exact format of `urlcodec fuzz` (native): idx,
// alphabet, status, coded-or-error, roundtrip flag, fnv64(encodeJSON|decodeJSON),
// dist_hash, logit_hash — flushed one at a time as each case finishes.
// run_fuzz.sh/run_tiers.sh diff the two sides. The loop itself lives in
// driver_common.js, shared with threads_driver.js (tier 3).
// Optional shard/shards (same convention as the native `fuzz` subcommand):
// only cases with idx % shards == shard run, still emitted in idx order, so
// N run_tiers.sh output files back to N shards. sort -n -m merges them.
//   node driver.js <urlcodec.wasm> <model.nurl> <tokenizer.json> <n> <seed> [shard] [shards]
const fs = require('fs');
const { runFuzz } = require('./driver_common.js');

const [wasmPath, modelPath, tokPath, nArg, seedArg, shardArg, shardsArg] = process.argv.slice(2);

(async () => {
  const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {});
  runFuzz(instance.exports, instance.exports.memory, {
    modelPath, tokPath,
    n: nArg || 500, seed: seedArg || 1, threads: 0,
    shard: shardArg || 0, shards: shardsArg || 1,
  });
})();
