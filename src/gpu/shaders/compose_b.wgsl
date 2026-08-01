// GPU-generated source B: the shared snowSource generator, but B has no compose
// stage of its own (it goes straight from upload to encode), so this is a
// standalone pass writing directly into srcTexB.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var srcTexB: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ACTIVE_W || gid.y >= ACTIVE_H) {
    return;
  }
  textureStore(srcTexB, vec2i(gid.xy), vec4f(snowSource(P.srcNoiseB, gid.xy, P.frame), 1.0));
}
