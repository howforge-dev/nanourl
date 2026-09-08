// Kernel bench: init once, encode a fixed URL 20 times, print median ms per
// token. driver.js minus the cross-runtime diffing -- same wasm ABI calls,
// timed instead of hashed. The loop lives in driver_common.js so the bench
// and the parity gate exercise identical code.
//
// Which memory to use is decided by the MODULE, not by W: urlcodec-mt.wasm
// imports `env.memory` and must be given a shared one whatever W is (W = 0 on
// the mt file is a real measurement -- it isolates the cost of the atomics
// build from the cost of the workers). The single-thread tiers export their
// own memory and take no import object.
//
// W workers are parked in worker_main before the timing loop starts, so
// worker spawn cost is not charged to the median.
//   node fuzz/bench.js <urlcodec.wasm> <model.nurl> <tokenizer.json> [W]
const fs = require('fs');
const { spawnWorkers, runBench } = require('./driver_common.js');

const [wasmPath, modelPath, tokPath, wArg] = process.argv.slice(2);
const W = Number(wArg || 0);

const bytes = fs.readFileSync(wasmPath);
const mod = new WebAssembly.Module(bytes);
const importsMemory = WebAssembly.Module.imports(mod)
  .some((i) => i.kind === 'memory' && i.module === 'env' && i.name === 'memory');
if (W > 0 && !importsMemory) {
  console.error(`${wasmPath} has no shared memory import: build urlcodec-mt.wasm for W > 0`);
  process.exit(1);
}

const memory = importsMemory
  ? new WebAssembly.Memory({ initial: 4096, maximum: 16384, shared: true }) // 256 MiB .. 1 GiB
  : null;
const inst = new WebAssembly.Instance(mod, memory ? { env: { memory } } : {});
const mem = memory || inst.exports.memory;
if (W > 0) spawnWorkers(inst.exports, mem, mod, W);
runBench(inst.exports, mem, { modelPath, tokPath, threads: W, label: wasmPath });
