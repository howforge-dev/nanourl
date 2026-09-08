// Shared body of the wasm-side harnesses: one copy of the C-ABI plumbing,
// the fuzz loop and the bench loop, so driver.js (single-thread) and
// threads_driver.js (tier 3) cannot drift apart in what they measure or
// print. Parity between their outputs is only meaningful if the loop
// producing them is literally the same code.
//
// `memory` is passed in rather than read off `exports`: the mt build IMPORTS
// its memory (`env.memory`, shared) and therefore does not export one.
const fs = require('fs');
const { Worker } = require('node:worker_threads');
const path = require('node:path');

const ALIGN = 16;
// codec_init's `threads` word, bit 17: fold the per-step parity digests.
// Off in production (they cost ~98 KB of hashing per step); every fuzz
// harness turns them on, and compare_tiers.py refuses a run without them.
const DIGEST_BIT = 1 << 17;

function fnv(s) {
  const bytes = Buffer.from(s, 'utf8');
  let h = 0xcbf29ce484222325n;
  const M = 0x100000001b3n, MASK = 0xffffffffffffffffn;
  for (const b of bytes) { h ^= BigInt(b); h = (h * M) & MASK; }
  return h.toString(16).padStart(16, '0');
}

// ptr/len marshalling. mem.buffer is re-read on every access because a wasm
// memory.grow (the model copy triggers several) replaces the JS-visible
// buffer object; a cached view would silently address freed space.
function io(w, mem) {
  const put = (buf) => {
    const ptr = w.ualloc(buf.length);
    new Uint8Array(mem.buffer, ptr, buf.length).set(buf);
    return [ptr, buf.length];
  };
  const readPacked = (packed) => {
    const rp = Number(packed >> 32n), rl = Number(packed & 0xffffffffn);
    return Buffer.from(new Uint8Array(mem.buffer, rp, rl)).toString('utf8');
  };
  return { put, readPacked };
}

// Spawn W worker instances of the SAME module over the SAME shared memory,
// each with its own stack and TLS block carved out of wasm memory by the
// coordinator's own allocator. Ids are 1..=W: the wasm side uses the id to
// decide which workers take part in a job, so exactly W of them report done.
// Workers are unref'd: they never return from worker_main, so they must not
// hold the event loop open.
//
// Then BLOCK until threads_ready() === W. threads_ready() is a true COUNT of
// the workers that reached the worker loop, one per register() call -- not
// max(id), which reaches W the instant the highest-numbered worker registers,
// leaving 1..W-1 still booting. Waiting on a count is what makes this barrier
// real: codec_init refuses a W larger than the registered count (rc 4), and
// a worker that misses the barrier would
// snapshot `gen` after the first job was posted, sit it out, and burn the
// coordinator's whole join bound on the first gemv.
//
// Ids must be exactly 1..=W with no gap and no repeat -- codec_init also
// rejects a registered set whose max id disagrees with the count (rc 4),
// because a job completes only when every id <= W reports done. Workers run
// on their own OS threads, so a synchronous spin here does not prevent them
// booting.
function spawnWorkers(w, mem, mod, W, deadlineMs = 10000) {
  const aligned = (p) => (p + (ALIGN - 1)) & ~(ALIGN - 1);
  // One source of truth for the stack size: the wasm validates the stack
  // pointer against its own constant, so ask it rather than duplicating.
  const stackBytes = w.thread_stack_bytes();
  if (!w.__tls_size) {
    // Defaulting tlsBase to 0 would make thread_setup splatter the TLS
    // template over address 0 -- it rejects that, but the build is broken
    // either way, so say so here rather than after N confusing failures.
    throw new Error('module does not export __tls_size: add -C link-arg=--export=__tls_size');
  }
  const tlsSize = w.__tls_size.value;
  const workers = [];
  for (let id = 1; id <= W; id++) {
    const stackTop = aligned(w.ualloc(stackBytes + ALIGN)) + stackBytes;
    const tlsBase = aligned(w.ualloc(tlsSize + ALIGN));
    const t = new Worker(path.join(__dirname, 'mt_worker.js'), {
      workerData: { mod, memory: mem, id, stackTop, tlsBase },
    });
    t.on('error', (e) => { console.error('worker failed:', e.message); process.exit(1); });
    t.unref();
    workers.push(t);
  }
  const t0 = Date.now();
  while (w.threads_ready() < W) {
    if (Date.now() - t0 > deadlineMs) {
      throw new Error(`only ${w.threads_ready()} of ${W} workers registered within ${deadlineMs}ms`);
    }
  }
  return workers;
}

// codec_init + the model/tokenizer copy, shared by every harness.
// Codes: 1 tokenizer not UTF-8, 2 bad model, 3 bad tokenizer JSON, 4 W vs the
// registered set, 5 vocab mismatch, 6 the instance is poisoned by a tier-3
// fault (terminal -- build a new module/workers/memory).
// `digests` sets DIGEST_BIT: on for the parity harnesses, off for the bench
// so it times the code a user actually runs.
function initCodec(w, mem, modelPath, tokPath, threads, digests) {
  const { put, readPacked } = io(w, mem);
  const model = fs.readFileSync(modelPath), tok = fs.readFileSync(tokPath);
  const [mp, ml] = put(model), [tp, tl] = put(tok);
  const rc = w.codec_init(mp, ml, tp, tl, (threads | 0) | (digests ? DIGEST_BIT : 0));
  if (rc !== 0) {
    // 1 tokenizer not UTF-8, 2 bad model, 3 bad tokenizer JSON, 4 W exceeds
    // the registered count or the ids are not 1..=N, 5 tokenizer/model vocab
    // mismatch, 6 threads asked for after a tier-3 fault (terminal for this
    // instance -- make a new one).
    const why = {
      4: `asked for ${threads} workers, ${w.threads_ready ? w.threads_ready() : '?'} registered`,
      5: 'the tokenizer and the model disagree on the vocabulary size',
      6: 'this instance is poisoned by a tier-3 fault -- discard module, workers and memory',
    }[rc];
    console.error(`codec_init failed: ${rc}${why ? ` (${why})` : ''}`);
    process.exit(1);
  }
  w.ufree(mp, ml); w.ufree(tp, tl);
  return { put, readPacked };
}

// The fuzz loop. Emits lines in the exact format of `urlcodec fuzz` (native):
// idx, alphabet, status, coded-or-error, roundtrip flag, fnv64 of the raw
// encode+decode JSON, dist_hash, logit_hash. Flushed one case at a time so a
// long shard's progress is visible in the output file rather than going dark
// until process exit.
function runFuzz(w, mem, { modelPath, tokPath, n, seed, threads, shard, shards }) {
  const { put, readPacked } = initCodec(w, mem, modelPath, tokPath, threads, true);
  const N = BigInt(n), SEED = BigInt(seed);
  const SHARD = BigInt(shard), SHARDS = BigInt(shards);
  for (let i = SHARD; i < N; i += SHARDS) {
    const url = readPacked(w.fuzz_url(SEED, i));
    // The same cycle as `urlcodec fuzz` (src/main.rs): offset by one every 8
    // cases so no fuzzgen URL mode is paired with a single alphabet forever.
    const alpha = Number((i + i / 8n) % 4n);
    const alph = ['b79', 'b64', 'emoji-1k', 'qr-alpha'][alpha];
    const [up, ul] = put(Buffer.from(url, 'utf8'));
    const ej = readPacked(w.codec_encode(up, ul, alpha));
    w.ufree(up, ul);
    const e = JSON.parse(ej);
    if (!e.ok) {
      process.stdout.write(`${i}\t${alph}\tERR\t${e.error}\t-\t${fnv(ej)}\t-\t-\n`);
      continue;
    }
    const [cp, cl] = put(Buffer.from(e.coded, 'utf8'));
    const dj = readPacked(w.codec_decode(cp, cl, alpha));
    w.ufree(cp, cl);
    const d = JSON.parse(dj);
    const rt = d.ok && d.url === url;
    process.stdout.write(
      `${i}\t${alph}\tOK\t${e.coded}\t${rt ? 'RT_OK' : 'RT_FAIL'}\t` +
      `${fnv(ej + '|' + dj)}\t${e.dist_hash}\t${e.logit_hash}\n`
    );
  }
}

// The bench loop: init once, encode a fixed URL RUNS times, report the median.
const URL_FIXED = 'https://news.ycombinator.com/item?id=38000000&p=2';

function runBench(w, mem, { modelPath, tokPath, threads, runs = 20, label }) {
  // digests OFF: the bench must measure the shipped encode, not the harness.
  const { put, readPacked } = initCodec(w, mem, modelPath, tokPath, threads, false);
  const kernel = JSON.parse(readPacked(w.codec_info())).kernel;
  let steps = 0; // URL tokens + the trailing <eos> step
  const ms = [];
  for (let i = 0; i < runs; i++) {
    const [up, ul] = put(Buffer.from(URL_FIXED, 'utf8'));
    const t0 = process.hrtime.bigint();
    const packed = w.codec_encode(up, ul, 0);
    const t1 = process.hrtime.bigint();
    w.ufree(up, ul);
    const e = JSON.parse(readPacked(packed));
    if (!e.ok) { console.error('encode failed:', e.error); process.exit(1); }
    steps = e.tokens.length; // == url tokens + 1 (<eos>)
    ms.push(Number(t1 - t0) / 1e6);
  }
  ms.sort((a, b) => a - b);
  const median = ms[Math.floor(ms.length / 2)];
  console.log(
    `${label}\tkernel=${kernel}\tworkers=${threads}\tsteps=${steps}\t` +
    `median_ms=${median.toFixed(3)}\tms_per_token=${(median / steps).toFixed(4)}`
  );
}

module.exports = { fnv, io, spawnWorkers, initCodec, runFuzz, runBench, URL_FIXED, DIGEST_BIT };
