# How it works

The whole program is one array of numbers and a chain of small GPU programs
that rewrite it.

## The array

A frame of NTSC is 525 lines of 910 samples: 477,750 floats, one voltage each.
It is allocated once in GPU memory and never comes back to the CPU. Sample `s`
of line `row` is at index `row * 910 + s`.

## A compute shader is the body of a for loop

Shifting every line sideways would be this on the CPU:

```js
for (let n = 0; n < signal.length; n++) {
  out[n] = interpolate(signal, n + offsetForLine[Math.floor(n / 910)])
}
```

478k iterations, a dozen stages, 60 times a second — hopeless on one thread. A
GPU runs that body for every `n` at once, so you write only the body and it
hands you the `n`. That is `timebase.wgsl`, trimmed:

```wgsl
@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let s = gid.x;      // sample across the line
  let row = gid.y;    // which line
  if (s >= SPL || row >= NLINES) { return; }

  let n = row * SPL + s;
  let pos = f32(n) + lineParams[row].x;
  dst[n] = catmull(src, pos);
}
```

Thousands of copies run at once in no particular order, which is safe because
each writes only its own `dst[n]`.

## Launching it

```ts
cp.dispatchWorkgroups(Math.ceil(910 / 64), 525)
```

Those are the bounds of the loop, and they come back as `gid`. Threads launch
in fixed blocks of 64, so 15 blocks per line covers 910 samples with 50 to
spare — hence the `if (s >= SPL) { return; }` in every shader.

## The chain

A dozen passes like that in a row: encode the picture into the waveform, damage
it, decode it back. Each reads the array and writes it back.

Because the shaders stay compiled and resident, moving a slider just writes a
number the next frame reads. Nothing recompiles.

---

Pass list in `src/gpu/pipeline.ts`, shaders in `src/gpu/shaders/`. The full pass
order and buffer layouts are in [`ARCHITECTURE.md`](ARCHITECTURE.md).
