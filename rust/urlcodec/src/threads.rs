//! Kernel tier 3: row-partitioned gemv across W compute workers sharing one
//! linear memory.
//!
//! One job at a time. The coordinator (the codec's own thread) posts a
//! descriptor, bumps `gen`, then joins the workers in draining a shared
//! block cursor until every row is done.
//!
//! **Bit-identity for any W.** Each output row is computed end to end by a
//! single participant, in the same group order as the single-thread kernel
//! (`QuantMat::gemv_rows` is the one and only kernel body). Nothing is summed
//! across participants, so `out[r]` depends only on `r`, not on which
//! participant took it, nor on how many there were. W = 0, 1 and 4 produce
//! the same bits; so does the same W twice with a different block split.
//! `fuzz/run_tiers.sh` asserts it.
//!
//! **Why a shared cursor rather than fixed equal shares.** Fixed shares are
//! strictly worse: with every participant spinning, the
//! OS load balancer sees no idle time, so an unlucky placement that puts two
//! wasm threads on one vCPU stays put for the whole run and every job waits
//! for that pair to run serially. Measured on an 8-vCPU box, fixed shares were
//! stable and good up to W = 3 and then *bimodal*: W = 7 came out at 5.1
//! ms/token on one run and 13.0 on the next, W = 5 at 17.6 and 27.4. Handing
//! out 64-row blocks on demand makes a slow participant take fewer
//! blocks, which is the same reason work-stealing beats static partitioning
//! everywhere else.
//!
//! **Exactly W participants, chosen by id.** A worker takes part in a job
//! only while its `id` is within the configured W, so the coordinator's
//! `done == W` wait is exact even when more workers are parked than the codec
//! was told about. Without that, `codec_init(.., 4)` against 7 parked workers
//! would let the coordinator leave its wait after 4 of the 7 had reported
//! while the other 3 were still writing `out`: a torn logit vector and a
//! stream that does not decode elsewhere, with nothing to observe it.
//!
//! **A dead worker cannot hang the codec.** `codec_init` refuses a W larger
//! than the workers that registered, so the *boot-time* mismatch never
//! reaches a job. The case that survives that check is a worker dying
//! mid-session: OOM-killed, an uncaught exception in the worker script, a
//! backgrounded tab throttled to death. `registered` never decreases and
//! `workers` is unchanged, so nothing upstream notices; the coordinator would
//! wait on a `done` that can never arrive, on a thread that by design
//! never parks. So [`join`] is bounded: on expiry it stops the cursor, drops
//! to single-threaded for the rest of the session, and reports
//! [`JOIN_TIMEOUT`] through `codec_info().threads_error` and a failed call.
//!
//! **A straggler that outlives the join, and why the answer is to throw the
//! instance away.** Giving up on a participant does not stop it: a worker
//! merely descheduled rather than dead is still *inside* `compute(r0, r1)`
//! and will finish that block whenever the OS runs it again, long after the
//! coordinator has moved on. Nothing in wasm can revoke that write, and
//! nothing in JS can wait for it either: `Worker.terminate()` returns
//! immediately and gives no completion signal, so a page cannot know when the
//! last write into the shared memory has landed.
//!
//! So the contract is **discard the instance**: on any fault the codec is
//! POISONED. [`poisoned`] becomes true and never goes back, every entry point
//! answers with the poison result instead of running the model, `codec_init`
//! refuses to rebuild over the same memory, and the client is expected to drop
//! the module, the workers and the `WebAssembly.Memory` together and start
//! again. The failed call
//! itself abandons its forward pass at the faulting matrix (`Model::step`
//! checks `poisoned()` after every gemv), so nothing ever reads an output a
//! straggler may still be writing, and the coordinator never recomputes into
//! those rows: two writers on one row was the other half of the hazard.
//!
//! Within that, two things still hold the line:
//!
//! - **The cursor is parked and the epoch bumped** on expiry, and workers
//!   re-check the epoch between claiming a block and writing it, so a
//!   straggler stops at its next block boundary. The exposure is one
//!   already-in-flight block, not the rest of the job.
//! - **A straggler only ever writes inside the buffer the faulted job named**,
//!   a `Model::step` local of the call that failed. Nothing reads it again:
//!   the pass is abandoned, and no later call runs.
//!
//! What is NOT bounded is *when*. The straggler is by definition descheduled,
//! so it resumes whenever the OS says. The coordinator returns within
//! microseconds of giving up, so the late write almost always lands **after**
//! that `Model::step` frame is gone, not before. Two consequences, both
//! accepted because the instance is discarded and neither can produce a wrong
//! stream:
//!
//! - `JOB.out` is a heap buffer, so the write is <= [`BLOCK`] rows (256 B)
//!   into an allocation that has since been freed, and 256 B at its base
//!   lands on the allocator's free-list links, so the damage is not confined
//!   to whatever later object occupies those bytes.
//! - `JOB.x` is worse in kind: it is `&hq`, a `QuantVec` **local of
//!   `Model::step`**, i.e. a shadow-stack address that the very next call on
//!   the coordinator thread reuses. [`worker_loop`] reconstructs it and
//!   `gemv_rows` reads through `x.q.as_ptr()` with an unchecked `v128_load`.
//!   A stale read there traps the worker or produces garbage floats it then
//!   writes into the equally-stale `out`. A leaked arena keeping those
//!   buffers alive would prevent this; the poison contract pays for skipping
//!   that machinery by accepting the risk.
//!
//! Copying those buffers into a leaked, retired arena would keep the
//! instance usable afterwards, but that guarantee is not worth buying: the
//! client discards the instance regardless, so the copy in and the copy out
//! on every parallel gemv would buy nothing.
//!
//! **No allocation in the worker loop.** The mt build is `-C panic=abort`, and
//! the worker touches nothing but the shared job descriptor and the read-only
//! weights, so the single-threaded allocator is never entered from two threads
//! at once.
//!
//! **Why the coordinator never calls `memory.atomic.wait32`:** a wait on the
//! browser's main thread traps. The codec may well be driven from the main
//! thread, so the coordinator only ever spins. Because it drains the
//! same cursor as everyone else, it only starts spinning once there are no
//! blocks left, so a healthy join is bounded by one straggler block, not by
//! the length of the job.
//!
//! **Why workers spin for a long time before sleeping.** A forward pass posts
//! ~61 gemv jobs per token (12 layers x 5, plus the head), separated by the
//! coordinator's serial work: attention, layernorms, softmax over the whole
//! vocabulary. A worker that parks in `memory.atomic.wait32` during one of
//! those gaps has to be woken by a `notify` on the next job, and that wake
//! costs microseconds *per worker*. Measured on an 8-vCPU box with a 2000-iteration
//! spin budget: W = 1 was 15.5 ms/token but W = 2 was 31.0 and W = 6
//! was 41.0: overhead growing linearly in W, i.e. the parallel kernel was
//! slower than no kernel at all. The spin budget below is sized to cover a
//! whole serial gap, and the coordinator skips the `notify` syscall entirely
//! while no worker is parked.
//!
//! The job protocol below is deliberately target-independent (the pointers
//! ride in `AtomicUsize`, and the per-block work is a closure) so the failure
//! paths can be tested with real threads on the host; see the tests at the
//! bottom. Only the two functions that plug `QuantMat` into it are wasm-only.

use core::sync::atomic::{AtomicU32, AtomicU64, AtomicUsize, Ordering};

/// Spins on `gen` before a worker parks. ~1M atomic loads is a few ms on the
/// hardware this targets: longer than any gap between two gemvs of one
/// forward pass, and short enough that an idle codec's workers stop burning
/// a core within milliseconds of the last token.
const SPIN_LIMIT: u32 = 1 << 20;

/// Rows handed out per claim. 64 rows x 1280 int4 columns is ~40 KB of weight
/// traffic, a few microseconds of work, two orders of magnitude more than
/// the `fetch_add` that claims it, while still giving the smallest production
/// matrix (1280 rows) 20 blocks to spread over at most 8 participants.
const BLOCK: usize = 64;

/// Iterations per chunk of the join wait.
///
/// The loop body MUST read the atomic: spinning on `core::hint::spin_loop()`
/// alone, reading `done` only once per chunk, does not work. `spin_loop()`
/// lowers to nothing on wasm, so that body has no observable effect and LLVM
/// deletes the loop outright, collapsing the bound from ~10^9 iterations to
/// ~10^5 atomic loads (well under a millisecond) and failing the N=100 gate
/// with a spurious "worker lost" on the first case of every mt process. An
/// atomic load cannot be optimized away, so reading it every iteration is
/// what makes the count mean anything.
const JOIN_CHUNK: u32 = 4096;

/// Chunks of `JOIN_CHUNK` spins the coordinator will wait for stragglers
/// before declaring a participant dead.
///
/// **This is a spin count, not a clock, and that is a compromise.** wasm32 has
/// no clock without a JS import, and the one timed primitive that exists
/// (`memory.atomic.wait32`'s timeout) traps for the coordinator, which may be
/// a browser main thread. So the bound is a calibrated iteration count:
/// ~256k chunks x 4096 atomic loads is ~10^9 reads, on the order of a second
/// or two on the hardware benched above; it scales with CPU speed rather
/// than wall clock.
///
/// It only has to separate "slow" from "never", and the margin needs to be
/// large, because the slowest legitimate join is not the steady state: it is
/// the FIRST job after the model load, when every worker has been idle long
/// enough to park in `memory.atomic.wait32` and has to come back through the
/// futex wake path. Steady-state joins wait for at most one 64-row block
/// (~10 µs); that first wake is orders of magnitude worse, and it is what a
/// too-tight bound trips over (measured: the gate reported a spurious "worker
/// lost" on case 1 of every mt process). [`set_join_chunks`] lets a loader or
/// a test move it.
const JOIN_CHUNKS_DEFAULT: u64 = 1 << 18;

/// [`join`] outcomes. Non-zero values are surfaced to JS as
/// `codec_info().threads_error` and abort the call that hit them, alongside
/// `codec_init`'s own return codes (4 = W exceeds the registered workers).
pub const JOIN_OK: u32 = 0;
/// A participant never reported `done` within the bound: presumed dead.
/// Threading is switched off for the rest of the session.
pub const JOIN_TIMEOUT: u32 = 2;

/// One in-flight gemv, described in shared memory. Pointers ride in
/// `AtomicUsize`: u32 on wasm32, where all of this actually runs, and
/// pointer-sized on the host so the protocol can be exercised by the tests.
///
/// Padded to one 64-byte cache line per contended field. `done` is
/// read-modify-written by every worker while the coordinator spins on it; if
/// it shared a line with `gen`, every worker's `gen` spin would miss cache on
/// every other worker's completion.
#[repr(C, align(64))]
pub struct Job {
    /// Bumped once per posted job; workers spin on a change. Own line: the
    /// coordinator writes it once per job and W workers read it hot.
    pub gen: AtomicU32,
    _pad0: [u32; 15],
    /// Next unclaimed block of the current job. Own line: every participant
    /// RMWs it in its inner loop.
    pub cursor: AtomicU32,
    _pad1: [u32; 15],
    /// Workers that have drained the cursor for the current job. Own line:
    /// W concurrent RMWs plus the coordinator's spin-read.
    pub done: AtomicU32,
    _pad1b: [u32; 15],
    /// Workers currently parked in `memory.atomic.wait32`. The coordinator
    /// only pays for a `notify` when this is non-zero.
    pub sleepers: AtomicU32,
    /// **How many** workers have reached `worker_loop`: a true count, one
    /// `fetch_add` per [`register`] call, not a `fetch_max` over the ids. A
    /// max is not a count and cannot support the instruction the loader is
    /// given ("poll `threads_ready()` until it equals W"): with ids 1..=W, a
    /// max reaches W the moment the *highest*-numbered worker registers, so a
    /// loader could pass the barrier with workers 1..W-1 still short of
    /// `worker_loop`; they would then snapshot `gen` after the first job was
    /// posted, sit it out, and the coordinator would burn its whole join
    /// bound on the very first gemv.
    ///
    /// Never decreases, which is exactly why a dead worker is caught by
    /// [`join`] and not by any check on this.
    pub registered: AtomicU32,
    /// Highest id ever passed to [`register`], alongside the count. The pair
    /// is what makes "ids 1..=N all booted" checkable: distinct ids 1..=N
    /// give `max_id == registered`, while a gap (worker 2 never booted:
    /// ids 1,3,4) gives `max_id > registered` and a worker respawned under an
    /// id that is already live gives `max_id < registered`. `codec_init`
    /// rejects both rather than posting a job to a participant set that
    /// cannot satisfy `done == W`.
    pub max_id: AtomicU32,
    _pad2: [u32; 13],
    /// Last non-zero [`join`] outcome, sticky, for `codec_info`.
    pub error: AtomicU32,
    /// Bumped on every fault. An entry point snapshots it and compares at the
    /// end, so a call whose result may have been torn by a dying worker
    /// fails instead of returning a stream nothing else can decode.
    pub faults: AtomicU32,
    /// Chunks of `JOIN_CHUNK` spins to wait for stragglers.
    pub join_chunks: AtomicU64,
    _pad3: [u32; 10],
    /// Job descriptor: written once per job by the coordinator, read-only to
    /// workers for the duration.
    pub mat: AtomicUsize,
    pub x: AtomicUsize,
    pub out: AtomicUsize,
    pub rows: AtomicU32,
    /// W: compute workers, excluding the coordinator. Workers with a higher
    /// id sit the job out, so exactly W of them bump `done`.
    pub workers: AtomicU32,
    _pad4: [u32; 10],
}

pub static JOB: Job = Job {
    gen: AtomicU32::new(0),
    _pad0: [0; 15],
    cursor: AtomicU32::new(0),
    _pad1: [0; 15],
    done: AtomicU32::new(0),
    _pad1b: [0; 15],
    sleepers: AtomicU32::new(0),
    registered: AtomicU32::new(0),
    max_id: AtomicU32::new(0),
    _pad2: [0; 13],
    error: AtomicU32::new(0),
    faults: AtomicU32::new(0),
    join_chunks: AtomicU64::new(JOIN_CHUNKS_DEFAULT),
    _pad3: [0; 10],
    mat: AtomicUsize::new(0),
    x: AtomicUsize::new(0),
    out: AtomicUsize::new(0),
    rows: AtomicU32::new(0),
    workers: AtomicU32::new(0),
    _pad4: [0; 10],
};

pub fn set_workers(w: u32) {
    JOB.workers.store(w, Ordering::SeqCst);
}

pub fn workers() -> u32 {
    JOB.workers.load(Ordering::Relaxed)
}

/// How many workers have reached the worker loop. A true count.
pub fn registered() -> u32 {
    JOB.registered.load(Ordering::SeqCst)
}

/// The highest id ever registered. Compared against [`registered`] by
/// `codec_init` to check the loader booted ids 1..=N; see [`Job::max_id`].
pub fn max_worker_id() -> u32 {
    JOB.max_id.load(Ordering::SeqCst)
}

pub fn error() -> u32 {
    JOB.error.load(Ordering::Relaxed)
}

/// **This instance is finished.** Set by the first [`join`] that times out
/// and never cleared: the entry points answer every later call with the
/// poison result rather than running the model, and `codec_init` refuses to
/// rebuild over the same memory. See the module header for why a fault is
/// terminal rather than recoverable.
pub fn poisoned() -> bool {
    error() != 0
}

pub fn fault_count() -> u32 {
    JOB.faults.load(Ordering::SeqCst)
}

pub fn set_join_chunks(n: u64) {
    JOB.join_chunks.store(n.max(1), Ordering::SeqCst);
}

/// Register as worker `id` and take the `gen` snapshot that goes with it.
///
/// The snapshot must be taken BEFORE registering: reversed, the coordinator
/// could post a job between the snapshot and the barrier being satisfied, and
/// this worker would miss it while the coordinator waited for its `done`.
pub fn register(id: u32) -> u32 {
    let seen = JOB.gen.load(Ordering::SeqCst);
    JOB.max_id.fetch_max(id, Ordering::SeqCst);
    JOB.registered.fetch_add(1, Ordering::SeqCst);
    seen
}

/// The address `memory.atomic.wait32` / `notify` synchronise on.
///
/// # Safety of the cast
/// `Job` is `repr(C, align(64))` and `gen` is its first field, so this is the
/// address of a `'static` 4-byte-aligned `u32` inside a `static` that lives
/// for the whole program. The wasm atomic intrinsics take `*mut i32` and only
/// ever perform aligned 32-bit atomic accesses on it, which is the same
/// access `AtomicU32` performs: no `&mut` is ever created, so the shared
/// reference other threads hold is never invalidated.
#[cfg(all(target_arch = "wasm32", target_feature = "atomics"))]
fn gen_ptr() -> *mut i32 {
    &JOB.gen as *const AtomicU32 as *mut i32
}

/// Wake any parked worker. Only pay for the syscall when somebody is parked.
/// The two SeqCst operations here and the worker's mirrored pair (register as
/// a sleeper, then re-read `gen`) cannot both miss: in the single total order,
/// either this load is after the worker's registration, so we notify, or the
/// worker's re-read is after the `gen` bump, so it never parks.
fn wake_workers() {
    if JOB.sleepers.load(Ordering::SeqCst) > 0 {
        // SAFETY: `gen_ptr()` is the aligned address of a `static` u32 (see
        // its doc); `memory.atomic.notify` only reads the wait queue for that
        // address and writes nothing, so it is sound for any count, including
        // when no thread is parked.
        #[cfg(all(target_arch = "wasm32", target_feature = "atomics"))]
        unsafe {
            core::arch::wasm32::memory_atomic_notify(gen_ptr(), u32::MAX)
        };
    }
}

/// Block until `gen` moves off `seen`, parking after [`SPIN_LIMIT`] spins.
/// Returns the new generation.
fn await_job(seen: u32) -> u32 {
    let mut spins = 0u32;
    while JOB.gen.load(Ordering::SeqCst) == seen {
        spins = spins.saturating_add(1);
        if spins > SPIN_LIMIT {
            JOB.sleepers.fetch_add(1, Ordering::SeqCst);
            // Re-read AFTER registering: if the coordinator's `gen` bump
            // landed in the window above it is visible here, and we skip the
            // park rather than sleeping through a notify that was never sent.
            if JOB.gen.load(Ordering::SeqCst) == seen {
                // SAFETY: as above, an aligned `static` u32 address, and
                // `wait32` compares-and-parks without writing. Only ever
                // reached from a worker thread; the coordinator never calls
                // it, because a wait on a browser main thread traps.
                #[cfg(all(target_arch = "wasm32", target_feature = "atomics"))]
                unsafe {
                    core::arch::wasm32::memory_atomic_wait32(gen_ptr(), seen as i32, -1)
                };
            }
            JOB.sleepers.fetch_sub(1, Ordering::SeqCst);
        } else {
            core::hint::spin_loop();
        }
    }
    JOB.gen.load(Ordering::SeqCst)
}

/// Claim and compute blocks of the current job until the cursor runs past the
/// end. Run by the coordinator and by every participating worker alike: the
/// only thing that differs is who bumps `done` afterwards.
///
/// Relaxed ordering on the cursor is enough: the descriptor was published
/// before `gen` (SeqCst) and is not touched again during the job, and the
/// only thing this RMW has to guarantee is that no two participants get the
/// same block, which `fetch_add` gives on its own.
///
/// `epoch` is the `gen` value the caller's job was posted under, and is
/// re-read between claiming a block and writing to it; see point (3) of the
/// module header. Parking the cursor on a fault already stops a worker from
/// claiming anything *new*; the epoch check is what stops a worker that
/// claimed a valid block and was then descheduled for longer than the join
/// bound. The coordinator passes `None`: it owns the descriptor and is the
/// one that retires it, so it cannot have the job pulled out from under
/// itself (`join` runs only after its own drain has returned).
pub fn drain_blocks(rows: usize, epoch: Option<u32>, mut compute: impl FnMut(usize, usize)) {
    loop {
        let b = JOB.cursor.fetch_add(1, Ordering::Relaxed) as usize;
        let r0 = b.saturating_mul(BLOCK);
        if r0 >= rows {
            return;
        }
        if let Some(e) = epoch {
            if JOB.gen.load(Ordering::SeqCst) != e {
                return; // this job was retired: the buffers are not ours
            }
        }
        compute(r0, (r0 + BLOCK).min(rows));
    }
}

/// Wait for every participant to report, with a bound. See
/// [`JOIN_CHUNKS_DEFAULT`] for why the bound is a spin count.
///
/// On expiry the job is RETIRED and the instance is POISONED. In order: the
/// cursor is parked past the end and the generation is bumped, so a straggler
/// that is still alive neither claims a new block nor starts the one it
/// already claimed; threading is switched off; [`poisoned`] goes true for
/// good, which makes every later entry point refuse to run the model at all;
/// and the fault counter is bumped so the *current* call fails rather than
/// handing back a result a dying worker may have torn.
fn join(w: u32) -> u32 {
    let limit = JOB.join_chunks.load(Ordering::Relaxed);
    let mut chunks: u64 = 0;
    loop {
        // The atomic read is INSIDE the inner loop on purpose: see JOIN_CHUNK.
        for _ in 0..JOIN_CHUNK {
            if JOB.done.load(Ordering::SeqCst) >= w {
                return JOIN_OK;
            }
            core::hint::spin_loop();
        }
        chunks += 1;
        if chunks > limit {
            // Stop handing out work to whoever is left, and invalidate the
            // epoch so a claimed-but-not-started block is dropped too.
            JOB.cursor.store(u32::MAX / 2, Ordering::SeqCst);
            JOB.gen.fetch_add(1, Ordering::SeqCst);
            set_workers(0);
            JOB.error.store(JOIN_TIMEOUT, Ordering::SeqCst);
            JOB.faults.fetch_add(1, Ordering::SeqCst);
            return JOIN_TIMEOUT;
        }
    }
}

/// Coordinator side of one job: publish `rows`, bump the generation, drain
/// alongside the workers, then join them. `compute` must already know where
/// the output lives (the wasm path publishes the descriptor first).
///
/// Returns [`JOIN_OK`] or [`JOIN_TIMEOUT`]. There is no "not enough
/// workers" outcome: `codec_init` refuses a W larger than `registered()`, and
/// `registered()` never decreases, so `workers() <= registered()` holds for
/// the life of the session and a barrier on it would be dead code. The
/// reachable failure is a worker that dies after registering, which only
/// [`join`] can see.
pub fn coordinate(rows: usize, compute: impl FnMut(usize, usize)) -> u32 {
    let w = workers();
    debug_assert!(w <= registered(), "codec_init must reject W > registered()");
    JOB.rows.store(rows as u32, Ordering::SeqCst);
    JOB.cursor.store(0, Ordering::SeqCst);
    JOB.done.store(0, Ordering::SeqCst);
    JOB.gen.fetch_add(1, Ordering::SeqCst);
    wake_workers();
    drain_blocks(rows, None, compute);
    join(w)
}

// ---------------------------------------------------------------- wasm glue

#[cfg(all(target_arch = "wasm32", target_feature = "atomics"))]
use crate::model::{QuantMat, QuantVec};

/// Compute one block of `mat · x` into the rows it owns.
///
/// # Safety
/// `base` must point at `rows` writable `f32`, and every other participant
/// must be draining this same cursor: that is what makes the `&mut` built
/// per block disjoint from every other participant's. The slice is built for
/// one block only and dies with it, so no reference ever spans rows another
/// participant may be writing.
#[cfg(all(target_arch = "wasm32", target_feature = "atomics"))]
unsafe fn block(mat: &QuantMat, x: &QuantVec, base: *mut f32, r0: usize, r1: usize) {
    let out = core::slice::from_raw_parts_mut(base.add(r0), r1 - r0);
    mat.gemv_rows(x, out, r0, r1);
}

/// Coordinator: `out = mat · x` using every participant. Returns [`JOIN_OK`]
/// or [`JOIN_TIMEOUT`].
///
/// **On [`JOIN_TIMEOUT`] the caller must not touch `out` at all**: not read
/// it (rows the straggler owned were never written, and it may be writing
/// them now) and not rewrite it (that would be two writers on one row). The
/// instance is poisoned by then, so `Model::step` abandons the pass at this
/// matrix and the entry point answers with the poison result.
///
/// # Safety
/// `base` must point at `rows` writable `f32` that nothing else is touching.
/// The caller must not hold a live reference spanning them for the duration:
/// only the disjoint per-block slices [`block`] builds may alias this memory.
/// After a [`JOIN_TIMEOUT`] a straggler may still write inside `out` and read
/// `x`, so both must stay allocated for as long as the caller's frame lives;
/// they are `Model::step` locals, and the poisoned instance is what
/// guarantees no later call reuses those bytes for anything that is read.
#[cfg(all(target_arch = "wasm32", target_feature = "atomics"))]
pub unsafe fn gemv_par(mat: &QuantMat, x: &QuantVec, base: *mut f32, rows: usize) -> u32 {
    JOB.mat
        .store(mat as *const QuantMat as usize, Ordering::SeqCst);
    JOB.x.store(x as *const QuantVec as usize, Ordering::SeqCst);
    JOB.out.store(base as usize, Ordering::SeqCst);
    coordinate(rows, |r0, r1| block(mat, x, base, r0, r1))
}

/// Worker side: take blocks off every job's cursor, forever.
///
/// Never allocates and never returns. `id` is 1-based and decides only
/// whether this worker takes part in a job at all (blocks themselves are
/// claimed, not assigned), so that exactly `workers()` of the parked workers
/// report `done` and the coordinator's wait is exact.
///
/// The `unsafe` reads reconstruct the references the coordinator published.
/// They stay valid because the coordinator does not return from `gemv_par`
/// until this worker has bumped `done`, or until the bounded join has given
/// up on it, after which the instance is poisoned, nothing reads those
/// buffers again, and the `epoch` argument below stops this worker before it
/// starts any *further* block.
#[cfg(all(target_arch = "wasm32", target_feature = "atomics"))]
pub fn worker_loop(id: u32) -> ! {
    let mut seen = register(id);
    loop {
        seen = await_job(seen);
        // Not one of the configured W: acknowledge the job by advancing
        // `seen` and take no blocks and no `done` slot.
        if id > JOB.workers.load(Ordering::SeqCst) {
            continue;
        }
        let mat = unsafe { &*(JOB.mat.load(Ordering::SeqCst) as *const QuantMat) };
        let x = unsafe { &*(JOB.x.load(Ordering::SeqCst) as *const QuantVec) };
        let rows = JOB.rows.load(Ordering::SeqCst) as usize;
        let base = JOB.out.load(Ordering::SeqCst) as *mut f32;
        drain_blocks(rows, Some(seen), |r0, r1| unsafe {
            block(mat, x, base, r0, r1)
        });
        JOB.done.fetch_add(1, Ordering::SeqCst);
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    /// `JOB` and [`ARENA`] are process globals and cargo runs `#[test]` fns
    /// from one binary on parallel threads, so every protocol test takes this
    /// lock rather than interleaving on the shared descriptor. Poison is
    /// ignored: a panicking test has already failed, and the next one wants a
    /// clean descriptor, not a second failure blamed on the first.
    pub fn job_lock() -> std::sync::MutexGuard<'static, ()> {
        static L: std::sync::Mutex<()> = std::sync::Mutex::new(());
        L.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Every test starts from a descriptor with no history: `error` and
    /// `workers` are sticky by design, so a previous test's fault would
    /// otherwise decide this one's outcome.
    pub fn reset_job() {
        JOB.cursor.store(0, Ordering::SeqCst);
        JOB.done.store(0, Ordering::SeqCst);
        JOB.registered.store(0, Ordering::SeqCst);
        JOB.max_id.store(0, Ordering::SeqCst);
        JOB.error.store(0, Ordering::SeqCst);
        set_workers(0);
        set_join_chunks(JOIN_CHUNKS_DEFAULT);
    }

    /// A worker that dies *after* registering (which no check on
    /// `registered` can see, because it never decreases) must time out
    /// rather than hang, and must poison the instance.
    ///
    /// The sibling test below covers the harder case, a worker that is merely
    /// *stalled inside a block* rather than gone.
    #[test]
    fn a_dead_worker_times_out_rather_than_hanging() {
        let _guard = job_lock();
        reset_job();
        const ROWS: usize = BLOCK * 8;

        // --- healthy: one real worker, one job, correct output ---
        // Keep the SHIPPED bound for this phase: a healthy join returns as
        // soon as `done` lands, so a large bound costs nothing here, while a
        // small one would make the phase flaky on a loaded machine.
        set_join_chunks(JOIN_CHUNKS_DEFAULT);
        let stop = Arc::new(AtomicBool::new(false));
        let mut out = vec![0f32; ROWS];
        let base = out.as_mut_ptr() as usize;
        JOB.out.store(base, Ordering::SeqCst);
        set_workers(1);
        JOB.registered.store(0, Ordering::SeqCst);
        JOB.error.store(0, Ordering::SeqCst);

        let stop_w = stop.clone();
        let worker = std::thread::spawn(move || {
            let mut seen = register(1);
            while !stop_w.load(Ordering::SeqCst) {
                // Poll rather than park: the host build has no wait32.
                if JOB.gen.load(Ordering::SeqCst) == seen {
                    std::thread::yield_now();
                    continue;
                }
                seen = JOB.gen.load(Ordering::SeqCst);
                if 1 > JOB.workers.load(Ordering::SeqCst) {
                    continue;
                }
                let p = JOB.out.load(Ordering::SeqCst) as *mut f32;
                let rows = JOB.rows.load(Ordering::SeqCst) as usize;
                drain_blocks(rows, Some(seen), |r0, r1| {
                    for r in r0..r1 {
                        unsafe { *p.add(r) = r as f32 };
                    }
                });
                JOB.done.fetch_add(1, Ordering::SeqCst);
            }
        });
        while registered() < 1 {
            std::thread::yield_now();
        }

        let p = base as *mut f32;
        let rc = coordinate(ROWS, |r0, r1| {
            for r in r0..r1 {
                unsafe { *p.add(r) = r as f32 };
            }
        });
        assert_eq!(rc, JOIN_OK, "a live worker must not time out");
        assert!(!poisoned());
        assert!((0..ROWS).all(|r| out[r] == r as f32), "every row computed");

        // --- the worker dies, and nothing upstream can tell ---
        stop.store(true, Ordering::SeqCst);
        worker.join().unwrap();
        assert_eq!(
            registered(),
            1,
            "registered never decreases: that is the gap"
        );
        assert_eq!(workers(), 1, "and W still counts on the dead worker");
        // Only now tighten the bound, so the timeout below takes a fraction of
        // a millisecond rather than the shipped ~second. 50 chunks is still
        // ~200k atomic loads: small enough to be instant in test terms, large
        // enough that the elapsed-time assert below has a wide margin.
        set_join_chunks(50);

        let faults_before = fault_count();
        let t0 = std::time::Instant::now();
        let rc = coordinate(ROWS, |_, _| {});
        let waited = t0.elapsed();
        assert_eq!(
            rc, JOIN_TIMEOUT,
            "a dead participant must time out, not hang"
        );
        assert_eq!(
            fault_count(),
            faults_before + 1,
            "the call must be marked tainted"
        );
        assert!(poisoned());
        assert_eq!(error(), JOIN_TIMEOUT);
        assert_eq!(workers(), 0, "threading is off for the rest of the session");
        // The bound must BURN the iterations it promises. A `join` that
        // spins on `spin_loop()` and reads `done` once per chunk has a body
        // with no observable effect, so LLVM deletes the loop and the
        // ~10^9-iteration bound silently becomes ~10^5 atomic loads:
        // sub-millisecond, which trips on the first (cold, parked-worker)
        // job of every mt process in the N=100 gate. 3 chunks x JOIN_CHUNK
        // reads cannot be instant unless the loop was optimized away.
        assert!(
            waited >= std::time::Duration::from_micros(10),
            "join returned in {waited:?}: the spin loop was optimized away, \
             so the bound means nothing (see JOIN_CHUNK)"
        );

        // --- the PROTOCOL still works at W = 0, but the instance does not ---
        // A further job with W = 0 joins immediately: no participants to wait
        // for, so no second timeout and no hang. That is a property of
        // `coordinate`, not a licence to keep using the codec: `poisoned()`
        // stays true, and `lib.rs`'s gate turns that into a refusal on every
        // entry point (see a_poisoned_instance_refuses_every_call).
        let mut out2 = vec![0f32; ROWS];
        let faults_before = fault_count();
        let rc = coordinate(ROWS, |r0, r1| {
            for r in r0..r1 {
                out2[r] = r as f32;
            }
        });
        assert_eq!(rc, JOIN_OK, "W = 0 must join immediately");
        assert_eq!(fault_count(), faults_before, "and must not fault again");
        assert!(
            (0..ROWS).all(|r| out2[r] == r as f32),
            "the serial drain is still correct"
        );
        assert!(poisoned(), "but the instance stays poisoned for good");

        reset_job();
        set_join_chunks(JOIN_CHUNKS_DEFAULT);
    }

    /// Point (3) of the module header, on its own: a block claimed under one
    /// generation must not be computed under another. Parking the cursor
    /// already stops the *next* claim; this is the window between a claim and
    /// the write that follows it, which is where a descheduled straggler
    /// lives.
    #[test]
    fn a_retired_epoch_stops_the_drain_at_the_next_block_boundary() {
        let _guard = job_lock();
        reset_job();
        JOB.gen.store(7, Ordering::SeqCst);
        let mut blocks = Vec::new();
        drain_blocks(BLOCK * 4, Some(7), |r0, _| {
            blocks.push(r0);
            // Whatever retires the job (a fault, or the next job being
            // posted) happens while we are inside a block.
            JOB.gen.store(8, Ordering::SeqCst);
        });
        assert_eq!(
            blocks,
            vec![0],
            "the drain must stop as soon as the epoch it claimed under is gone"
        );
        // ...and the coordinator, which passes None, is unaffected: it owns
        // the descriptor and retires it itself.
        JOB.cursor.store(0, Ordering::SeqCst);
        let mut all = Vec::new();
        drain_blocks(BLOCK * 4, None, |r0, _| {
            all.push(r0);
            JOB.gen.fetch_add(1, Ordering::SeqCst);
        });
        assert_eq!(all.len(), 4, "the coordinator drains its own job whole");
    }

    /// A tier-3 fault POISONS the instance: the failed call fails, every
    /// later call refuses to run the model, and the straggler that finishes
    /// its block afterwards writes only inside the buffer the faulted job
    /// named, which nothing reads again.
    ///
    /// This is the host half. `lib.rs`'s `poisoned_instance_refuses_every_call`
    /// asserts the ABI half (the entry points and `codec_init`), because the
    /// gate that turns `poisoned()` into an error result lives there.
    #[test]
    fn a_straggler_that_outlives_the_join_poisons_the_instance() {
        const ROWS: usize = BLOCK * 4;
        const SENTINEL: f32 = -12345.0;
        let _guard = job_lock();
        reset_job();

        // The job's output is a plain caller buffer: exactly what
        // `Model::step`'s locals are.
        let mut out = vec![0f32; ROWS];
        let base = out.as_mut_ptr() as usize;
        JOB.out.store(base, Ordering::SeqCst);
        set_workers(1);

        // `hold`: the worker parks inside its first block until `release`.
        // `entered`: it has actually got there, so the coordinator's own
        // first block can wait for it and the interleaving is deterministic
        // rather than a race between two draining threads.
        let hold = Arc::new(AtomicBool::new(false));
        let entered = Arc::new(AtomicBool::new(false));
        let release = Arc::new(AtomicBool::new(false));
        let stop = Arc::new(AtomicBool::new(false));
        let (hw, ew, rw, sw) = (hold.clone(), entered.clone(), release.clone(), stop.clone());

        let worker = std::thread::spawn(move || {
            let mut seen = register(1);
            let mut first = true;
            while !sw.load(Ordering::SeqCst) {
                if JOB.gen.load(Ordering::SeqCst) == seen {
                    std::thread::yield_now();
                    continue;
                }
                seen = JOB.gen.load(Ordering::SeqCst);
                if 1 > JOB.workers.load(Ordering::SeqCst) {
                    continue;
                }
                let p = JOB.out.load(Ordering::SeqCst) as *mut f32;
                let rows = JOB.rows.load(Ordering::SeqCst) as usize;
                let (hw, ew, rw) = (&hw, &ew, &rw);
                drain_blocks(rows, Some(seen), |r0, r1| {
                    if hw.load(Ordering::SeqCst) && first {
                        first = false;
                        ew.store(true, Ordering::SeqCst);
                        while !rw.load(Ordering::SeqCst) {
                            std::thread::yield_now();
                        }
                        // The coordinator gave up on us long ago. This is the
                        // write nothing can revoke.
                        for r in r0..r1 {
                            unsafe { *p.add(r) = SENTINEL };
                        }
                        return;
                    }
                    for r in r0..r1 {
                        unsafe { *p.add(r) = r as f32 };
                    }
                });
                JOB.done.fetch_add(1, Ordering::SeqCst);
            }
        });
        while registered() < 1 {
            std::thread::yield_now();
        }

        // --- phase 1: healthy job, correct output, not poisoned ---
        let p = base as *mut f32;
        let rc = coordinate(ROWS, |r0, r1| {
            for r in r0..r1 {
                unsafe { *p.add(r) = r as f32 };
            }
        });
        assert_eq!(rc, JOIN_OK, "a live worker must not time out");
        assert!(!poisoned());
        assert!(
            (0..ROWS).all(|r| unsafe { *p.add(r) } == r as f32),
            "every row computed"
        );

        // --- phase 2: the worker stalls inside a block past the bound ---
        hold.store(true, Ordering::SeqCst);
        set_join_chunks(4); // ~16k atomic loads: fast, and the worker is held
        let faults_before = fault_count();
        let rc = coordinate(ROWS, |r0, r1| {
            // Take exactly one block, then let the worker claim before doing
            // anything else, so it is guaranteed to be inside `compute` when
            // the join expires.
            while !entered.load(Ordering::SeqCst) {
                std::thread::yield_now();
            }
            for r in r0..r1 {
                unsafe { *p.add(r) = r as f32 };
            }
        });
        assert_eq!(rc, JOIN_TIMEOUT, "a held participant must time out");
        assert_eq!(fault_count(), faults_before + 1, "the call is tainted");
        assert_eq!(error(), JOIN_TIMEOUT);
        assert_eq!(workers(), 0, "threading is off");
        assert!(poisoned(), "and the instance is poisoned");

        // --- phase 3: the poison is sticky and nothing clears it ---
        // A further job with W = 0 joins immediately (no participants), but
        // the instance stays poisoned: only a new instance clears this.
        let faults_before = fault_count();
        let mut untouched = vec![7f32; ROWS];
        let rc = coordinate(ROWS, |r0, r1| {
            for r in r0..r1 {
                untouched[r] = r as f32;
            }
        });
        assert_eq!(rc, JOIN_OK, "W = 0 must join immediately");
        assert_eq!(fault_count(), faults_before, "and must not fault again");
        assert!(poisoned(), "the poison must not be cleared by a clean join");

        // --- phase 4: let the straggler finish its block, far too late ---
        release.store(true, Ordering::SeqCst);
        stop.store(true, Ordering::SeqCst);
        worker.join().unwrap();

        // It wrote into the FAULTED JOB'S OWN buffer and nowhere else. In the
        // real codec that buffer is a `Model::step` local of the call that
        // failed; the pass was abandoned at the faulting matrix, so nothing
        // read it, and the poisoned instance means no later call runs at all.
        assert!(
            out.contains(&SENTINEL),
            "the straggler was supposed to finish its block and write; if it \
             did not, this test is not exercising the hazard at all"
        );
        assert!(
            !untouched.contains(&SENTINEL),
            "and it must not have reached any other buffer"
        );
        assert!(
            (0..ROWS).all(|r| untouched[r] == r as f32),
            "the buffer the coordinator used after the fault is intact"
        );

        reset_job();
        set_join_chunks(JOIN_CHUNKS_DEFAULT);
    }
}
