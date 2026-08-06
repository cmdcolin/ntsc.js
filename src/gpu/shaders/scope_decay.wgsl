// Vectorscope trace persistence.
//
// A scope's spot is a single moving point; what reads as a shape is where the
// beam has recently been, held by the phosphor on the instrument's own tube.
// Clearing the bins every frame would make the trace a one-frame sample of
// that, which is fine on a still picture and strobes on a moving one — the
// constellation would flicker between frames instead of persisting through
// them. So the bins decay rather than clear, and what `present` reads is a few
// frames of beam integrated the way the glass would do it.
//
// Runs before decode scatters into the same buffer, and only when the scope is
// on; off, nothing touches it at all.

// No Params binding on purpose: this pass reads no uniform, and a binding a
// shader never statically uses is dropped from the auto-derived bind group
// layout — so declaring one here and supplying it would make the bind group
// invalid against its own layout.
@group(0) @binding(0) var<storage, read_write> scope: array<u32>;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= SCOPE_N * SCOPE_N) {
    return;
  }
  // Three quarters a frame: about a 3-frame e-fold at 60 Hz, close enough to
  // the trace phosphors these instruments used. Integer division is doing
  // something load-bearing at the bottom of the range — it takes a lone hit to
  // nothing on the next frame rather than parking it at 1 forever, so a stale
  // trace cannot accumulate into a permanent haze behind the live one.
  scope[i] = scope[i] * 3u / 4u;
}
