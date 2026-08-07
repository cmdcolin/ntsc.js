// A decoded video frame, sampled straight off the browser's decoder into a
// slot texture. The bitmap path (videopump.ts) spends main-thread and worker
// time per frame — createImageBitmap decodes and resizes on CPU, then the
// queue copies the result up — and that cost is what two playing clips charge
// against the frame budget. Where the browser can hand WebGPU the decoder's
// own frame (importExternalTexture — feature-detected in pipeline.ts; Chrome
// today, Firefox has no such API), this one dispatch replaces the whole trip.
//
// Two entry points because the two slots want different geometry, the same
// split sources.ts makes for the bitmap path: A keeps its own aspect (the
// texture was sized to the capped source, compose letterboxes it), B is
// cover-fit onto its fixed raster-sized texture with the centered 4:3 crop
// derived from the frame's own dimensions — coverFit43's twin, kept in step
// by eye: it is three lines, and the CPU side is pinned by its own tests.

@group(0) @binding(0) var srcVideo: texture_external;
@group(0) @binding(1) var vsamp: sampler;
@group(0) @binding(2) var dstTex: texture_storage_2d<rgba8unorm, write>;

fn blit(gid: vec3u, crop43: bool) {
  let dims = textureDimensions(dstTex);
  if (gid.x >= dims.x || gid.y >= dims.y) {
    return;
  }
  var uv = (vec2f(gid.xy) + 0.5) / vec2f(dims);
  if (crop43) {
    let s = vec2f(textureDimensions(srcVideo));
    let wide = s.x / s.y > 4.0 / 3.0;
    let cw = select(s.x, s.y * (4.0 / 3.0), wide);
    let ch = select(s.x * (3.0 / 4.0), s.y, wide);
    uv = ((s - vec2f(cw, ch)) * 0.5 + uv * vec2f(cw, ch)) / s;
  }
  textureStore(dstTex, vec2i(gid.xy), textureSampleBaseClampToEdge(srcVideo, vsamp, uv));
}

@compute @workgroup_size(8, 8, 1)
fn blit_fit(@builtin(global_invocation_id) gid: vec3u) {
  blit(gid, false);
}

@compute @workgroup_size(8, 8, 1)
fn blit_crop43(@builtin(global_invocation_id) gid: vec3u) {
  blit(gid, true);
}
