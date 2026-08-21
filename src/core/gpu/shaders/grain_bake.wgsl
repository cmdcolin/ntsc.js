// The phosphor deposit's mottle, baked once. Static value noise on a lattice
// of GRAIN_PX cells: hash the four surrounding cells and smoothstep between
// them, so the mottling is blobby rather than per-pixel sparkle. Two octaves
// because a real deposit is clumpy at more than one scale. Lives in
// active-picture space, i.e. on the glass — it does not crawl with the
// picture, and the zoom magnifies it.
//
// On the glass means it never changes, and crt_face was re-hashing it at
// every pixel of every frame: sixteen hashes a pixel, 0.115 ms of a 2.29 ms
// stock frame on the dev box (scripts/gpuprof, --set=crtGrain=0 against
// stock). One dispatch at engine construction, one texel load a frame after.

@group(0) @binding(0) var grainTex: texture_storage_2d<r32float, write>;

const GRAIN_PX = 2.3;

fn cellHash(c: vec2u) -> f32 {
  return rand01(pcg(c.x ^ pcg(c.y * 2654435761u)));
}

fn valueNoise(p: vec2f) -> f32 {
  let i = vec2u(floor(p));
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  let a = mix(cellHash(i), cellHash(i + vec2u(1u, 0u)), w.x);
  let b = mix(cellHash(i + vec2u(0u, 1u)), cellHash(i + vec2u(1u, 1u)), w.x);
  return mix(a, b, w.y);
}

fn grain(p: vec2f) -> f32 {
  return 0.62 * valueNoise(p / GRAIN_PX) + 0.38 * valueNoise(p / (GRAIN_PX * 0.37) + vec2f(31.7, 11.3));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ACTIVE_W || gid.y >= ACTIVE_H) {
    return;
  }
  textureStore(grainTex, vec2i(gid.xy), vec4f(grain(vec2f(gid.xy)), 0.0, 0.0, 1.0));
}
