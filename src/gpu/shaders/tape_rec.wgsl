// Record head of the loop bin. Whatever the mixer is putting out gets laid onto
// the tape as it passes, and one frame later that stretch of tape is somewhere
// further round the loop on its way to the play head.
//
// The loop stores composite as f16 pairs packed into a u32 — a frame of tape is
// 933 KiB that way, so a two-second loop fits inside the 128 MiB a storage
// binding is guaranteed. f16 resolves about 0.05 IRE, three orders finer than
// the noise floor the medium itself has, so nothing about the storage shows up
// in the picture; every artifact here is one the transport actually causes.
//
// Two samples per thread rather than one, because a packed word is written
// whole: 910 is even, so a line never straddles a word and no two threads ever
// contend for one.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> comp: array<f32>;
@group(0) @binding(2) var<storage, read_write> tape: array<u32>;

const TAPE_WORDS_PER_LINE = SPL / 2u;
const TAPE_WORDS_PER_FRAME = BUF_LEN / 2u;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let w = gid.x;
  let row = gid.y;
  if (w >= TAPE_WORDS_PER_LINE || row >= NLINES) {
    return;
  }
  let n = row * SPL + w * 2u;
  let at = P.tapeSlot * TAPE_WORDS_PER_FRAME + row * TAPE_WORDS_PER_LINE + w;
  tape[at] = pack2x16float(vec2f(comp[n], comp[n + 1u]));
}
