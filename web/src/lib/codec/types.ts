// Wire types shared between client.ts (main thread) and worker.ts (coordinator).
// These mirror the JSON the Rust codec (rust/urlcodec/src/lib.rs) returns —
// field names and shapes must match exactly, since later tasks import these.

/** The wasm coder's alphabet enum. Which id is which — and which one is the
 *  default — is spelled once, in `lib/alphabet.ts`'s `ALPHABETS`; this comment
 *  would otherwise be a third restatement of the mapping. */
export type Alphabet = 0 | 1 | 2;

export interface Tok {
  piece: string;
  bits: number;
  clo?: number;
  chi?: number;
  emit?: number;
  pend?: number;
}

export interface EncodeResult {
  ok: true;
  url: string;
  canonical: string;
  coded: string;
  version: number;
  url_chars: number;
  coded_chars: number;
  coded_bits: number;
  bitstr: string;
  model_bits: number;
  bits_per_char: number;
  ratio: number;
  tokens: Tok[];
}

export interface DecodeResult {
  ok: true;
  url: string;
  canonical: string;
  coded: string;
  version: number;
  url_chars: number;
  coded_chars: number;
  coded_bits: number;
  bits_per_char: number;
  tokens: Tok[];
}

export interface DistRow {
  piece: string;
  prob: number;
  bits: number;
}

export interface DistResult {
  ok: true;
  k: number;
  context: string;
  actual: DistRow & { rank: number };
  top: DistRow[];
}

export interface LayerTrace {
  attn: number[][];
  norm_in: number;
  norm_attn: number;
  norm_mlp: number;
  x: number[];
}

export interface TraceResult {
  ok: true;
  k: number;
  pieces: string[];
  pred: string;
  layers: LayerTrace[];
}

export interface SampleResult {
  ok: true;
  url: string;
  canonical: string;
  pieces: string[];
  terminated: boolean;
}

export interface Info {
  ok: true;
  n_layer: number;
  n_head: number;
  d_model: number;
  d_mlp: number;
  vocab: number;
  block: number;
  params: number;
  artifact_bytes: number;
  wte_offset: number;
  wpe_offset: number;
  kernel: string;
  stream_version: number;
}

export type Fail = { ok: false; error: string };

/** One '·'-separated segment of the status line. `num` segments render in
 *  tabular monospace so the line does not jitter as figures change width.
 *  Lives here with the other wire/UI shapes rather than in progress.ts, so
 *  the formatting module depends on the type module and not the reverse. */
export interface StatusPart {
  text: string;
  num?: boolean;
}

/** A load-progress tick. `text` and `parts` are the SAME line — `parts` keeps
 *  its '·'-separated segments apart so the status line can set the numeric
 *  ones in tabular monospace, `text` is the joined form. Both are omitted on
 *  a fraction-only tick (the loader emits those at animation rate and only
 *  re-renders the text every 100 ms), which is why every consumer must keep
 *  the last text it saw rather than blanking the line. */
export type Progress = { fraction: number; text?: string; parts?: StatusPart[] };
