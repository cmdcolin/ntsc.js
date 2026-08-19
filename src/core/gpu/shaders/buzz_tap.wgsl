// Intercarrier buzz, measurement half: what the sound detector picks up off the
// picture. `channel.wgsl`'s soundIre is this leak seen from the video side — the
// 4.5 MHz carrier arriving where the trap should have stopped it, drawn as a
// herringbone. The same leak read from the other end is the sound you hear: the
// audio detector recovers the 4.5 MHz beat between the picture and sound
// carriers, and AM-to-PM conversion in the IF folds the picture's own amplitude
// onto it, so video crosstalk arrives on the audio line.
//
// One thread per line, and what it measures is a *sound* channel's view of that
// line, which is why both numbers are scalars rather than a waveform:
//
// - `mean` is the whole line averaged, sync tip and blanking included, because
//   the detector sees the composite and not just the active picture. Averaging
//   910 samples is the anti-alias filter that decimation to line rate needs,
//   and line rate is 31.5 kHz here — a real audio sample rate whose Nyquist
//   lands right at the top of the audio band. So the stream of means *is* the
//   buzz, at the correct bandwidth, with no resampling anywhere.
// - `dev` is the RMS deviation within the line, which the mean has just thrown
//   away. Snow, and detail on a busy picture, live above line rate; the boxcar
//   above keeps only the ~15.75 kHz of it that fits, while the real sound
//   channel is a ~50 kHz slice around 4.5 MHz and FM detection weights the top
//   of that slice hardest. The CPU side folds `dev` back in as noise to cover
//   the difference (`signal/buzz.ts`); without it a snowy channel goes nearly
//   silent, which is the one thing a listener would notice as wrong.
//
// Reads compA where the receiver does — after the enhancer has had the signal,
// so the sound hears the same waveform sync locks to.

@group(0) @binding(0) var<storage, read> comp: array<f32>;
@group(0) @binding(1) var<storage, read_write> buzz: array<vec2f>;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let row = gid.x;
  if (row >= NLINES) {
    return;
  }
  let base = row * SPL;
  var sum = 0.0;
  var sq = 0.0;
  for (var s = 0u; s < SPL; s = s + 1u) {
    let v = comp[base + s];
    sum = sum + v;
    sq = sq + v * v;
  }
  let n = f32(SPL);
  let mean = sum / n;
  // max() because the two-pass identity is only exact in exact arithmetic, and
  // a flat line lands a hair below zero here.
  let variance = max(0.0, sq / n - mean * mean);
  buzz[row] = vec2f(mean, sqrt(variance));
}
