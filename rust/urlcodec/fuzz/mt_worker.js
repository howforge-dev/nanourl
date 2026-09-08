// One tier-3 compute worker. Instantiates the SAME module over the SAME
// shared memory as the coordinator, points its stack and TLS at regions the
// coordinator allocated out of that memory, and parks in worker_main.
//
// Globals (__stack_pointer, __tls_base) are per-INSTANCE even when the memory
// is shared, which is exactly what makes this work: one address space, N
// independent stacks.
//
// ORDER MATTERS, and this is the reference the web loader should copy:
//   1. write __stack_pointer  (JS only -- see thread_setup's doc comment: an
//      in-wasm `global.set` is bracketed by LLVM with a save/restore and is
//      undone on return, verified on the pinned nightly at -O0 and -O)
//   2. thread_setup(stackTop, tlsBase), and CHECK ITS RETURN -- it validates
//      that step 1 actually happened, because a worker running on the default
//      stack pointer silently shares the coordinator's stack
//   3. worker_main(id), which never returns
//
// Ids are 1-based and must be exactly 1..=W across the workers spawned, with
// no gap and no repeat. register() counts them (threads_ready() is that
// count) and records the highest id; codec_init rejects a set where the two
// disagree, because a job only completes when every id <= W reports done. A
// worker that throws below never registers, so the coordinator's
// threads_ready() poll simply never reaches W and it falls back a tier --
// which is why this file throws instead of limping on.
//
// There is no way to STOP a worker that has already entered worker_main:
// worker_main never returns, and Worker.terminate() resolves nothing you can
// wait on -- it gives no signal that the thread's last write into the shared
// memory has landed. That is exactly why a tier-3 fault poisons the whole
// instance rather than dropping to a lower tier in place: the only safe
// disposal is to drop this module, these workers and this memory together.
const { workerData } = require('node:worker_threads');

const { mod, memory, id, stackTop, tlsBase } = workerData;
const inst = new WebAssembly.Instance(mod, { env: { memory } });
inst.exports.__stack_pointer.value = stackTop;
const rc = inst.exports.thread_setup(stackTop, tlsBase);
if (rc !== 0) {
  throw new Error(
    `worker ${id}: thread_setup failed (${rc}) — ` +
    `${rc === 1 ? '__stack_pointer was not set before the call' : 'null TLS base'}`
  );
}
inst.exports.worker_main(id);
