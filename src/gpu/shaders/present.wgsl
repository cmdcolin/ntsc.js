// Present the CRT face (faceTex, the glowing screen — not the raw decode): 4:3
// letterbox, a finite gaussian beam-spot profile across scanlines, and the
// magnifier. Past 1x the magnifier closes in on the glass; below it the camera
// pulls back off the set, and what surrounds the picture is the object holding
// the glass — a small tube TV on a stand, lit by nothing but its own screen.
// No geometry/vignette kitsch.

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var screenTex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VOut;
  o.pos = vec4f(pos[vi], 0.0, 1.0);
  o.uv = pos[vi] * vec2f(0.5, -0.5) + vec2f(0.5);
  return o;
}

// The set, in units where the glass is 4 wide and 3 tall — screen-isotropic, so
// a bezel of constant thickness stays constant. The cabinet is off-centre: the
// tube sits left, leaving a control panel down the right side, which is what a
// portable set of this era looked like.
const GLASS = vec2f(2.0, 1.5);
const GLASS_R = 0.18; // tube corners are rounded, but only slightly
const CURVE = 0.11; // faceplate bulge: how much the glass swells at the corners
const CAB_C = vec2f(0.26, 0.0);
const CAB = vec2f(2.66, 1.9);
const KNOB_X = 2.52;

fn roundBox(p: vec2f, b: vec2f, r: f32) -> f32 {
  let d = abs(p) - b + vec2f(r);
  return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0) - r;
}

// Light escaping the edge of the glass has bounced through the phosphor layer and
// around the bezel before it lands on the cabinet, so it arrives as a wash rather
// than a stencil of whichever pixel it started at. Taps around the nearest point
// on the picture, spreading wider the further out the light has travelled.
fn spillAt(tuv: vec2f, dist: f32, phase: f32) -> vec3f {
  let w = (0.05 + 0.45 * dist) * vec2f(0.75, 1.0);
  var acc = vec3f(0.0);
  // Golden-angle taps at mixed radii, the set rotated per pixel: six taps at
  // fixed angles leave their own count behind as rays fanning out from the set,
  // and rotating them turns that into a dither nobody can see.
  for (var i = 0u; i < 6u; i = i + 1u) {
    let a = f32(i) * 2.3999632 + phase;
    let rr = sqrt((f32(i) + 0.5) / 6.0);
    let p = clamp(tuv + vec2f(cos(a), sin(a)) * rr * w, vec2f(0.0), vec2f(1.0));
    acc = acc + textureSampleLevel(screenTex, samp, p, 0.0).rgb;
  }
  return acc / 6.0;
}

// The moulded plastic, and the light its own screen throws on it. `spill` is the
// picture colour nearest this point: the glass edge lights what is beside it, so
// the cabinet takes a tint from whatever is playing and the dark behind it falls
// off to nothing.
fn cabinet(s: vec2f, spill: vec3f, glassDist: f32) -> vec3f {
  let d = roundBox(s - CAB_C, CAB, 0.22);
  let lit = spill / (1.0 + 3.0 * glassDist * glassDist);
  // Beyond the set: no albedo of its own, only the glow the tube throws past it.
  if (d > 0.0) {
    return lit * 0.22 * exp(-2.6 * d);
  }
  // Cabinet: dark grey, shading down toward the bottom, with the two control
  // knobs sunk into the right-hand panel and a vent slot under them.
  var albedo = vec3f(0.14) * (1.0 - 0.3 * smoothstep(-1.9, 2.4, s.y));
  let knob = min(
    length(s - vec2f(KNOB_X, -0.56)) - 0.2,
    length(s - vec2f(KNOB_X, 0.1)) - 0.2,
  );
  // A dark ring around a brighter face, so the knobs read as objects, not dots.
  albedo = albedo * (1.0 + smoothstep(0.03, -0.03, knob) - 0.7 * smoothstep(0.06, 0.0, abs(knob)));
  let vent =
    smoothstep(0.06, 0.0, abs(s.x - KNOB_X) - 0.22) *
    smoothstep(0.05, 0.0, abs(fract(s.y * 6.0) - 0.5) - 0.18) *
    step(0.75, s.y) * step(s.y, 1.45);
  albedo = albedo * (1.0 - 0.55 * vent);
  // Two edges catch the light and are what make the shape read in the dark: the
  // moulded outer corner of the cabinet, and the lip where the bezel curls in to
  // meet the glass — which is also what makes a lit tube look recessed.
  let outline = smoothstep(0.07, 0.0, -d) * 0.5;
  let lip = smoothstep(0.06, 0.0, glassDist);
  let rim = smoothstep(0.34, 0.0, glassDist);
  return albedo * (0.4 + outline + 3.0 * lit + 2.2 * rim * lit + 1.2 * lip);
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  if (P.dbgView == 1.0) {
    return vec4f(in.uv, 0.5, 1.0);
  }
  let cs = vec2f(P.canvasW, P.canvasH);
  let px = in.uv * cs;
  let scale = min(cs.x / 4.0, cs.y / 3.0);
  let half = vec2f(2.0 * scale, 1.5 * scale);
  let rel = (px - cs * 0.5) / half;
  // Magnifier: move the viewer closer to the glass, about the point under the
  // lens. Everything that lives in glass space — scanline structure, the sample
  // reconstruction, phosphor grain, the beam spot's bleed — magnifies with it,
  // and the grille pitch below is scaled to match, so zooming in shows the
  // actual structure the picture is built out of rather than a blown-up image.
  // The lens sees 1/zoom of each axis, so its centre is held far enough inside
  // the picture that it can never look past the edge of the glass. Pulled back
  // the whole picture is in view, so the centre is simply the middle.
  let zoom = max(P.crtZoom, 0.05);
  let halfView = 0.5 / zoom;
  let lens = select(
    vec2f(0.5),
    clamp(vec2f(P.crtZoomX, P.crtZoomY), vec2f(halfView), vec2f(1.0 - halfView)),
    zoom > 1.0,
  );
  let flat = (rel * 0.5 + vec2f(0.5) - lens) / zoom + lens;
  // Screen position in set units, before the glass gets in the way.
  let sp = (flat - vec2f(0.5)) * vec2f(4.0, 3.0);
  // How much of the set is on show. Pulling back past 1x is what reveals the
  // tube as an object, so the shell, the rounded corners and the faceplate bulge
  // all come in together with how far back the camera is — and none of them
  // exist at 1x and closer, where the picture fills the frame as before.
  let back = clamp(1.0 - zoom, 0.0, 1.0);
  // Faceplate curvature: the tube face is a section of a sphere bulging toward
  // the viewer, so its rim tilts away and the picture there is foreshortened. The
  // sample point is pushed *out* with the radius, which compresses content toward
  // the rim and pulls the corners of the glass in — barrel distortion, the two
  // cues that read as domed. Pushing the other way stretches the rim instead,
  // which is what a dished screen would do. The push saturates with radius so the
  // room outside the set stays a plain scale of screen position.
  let n = sp / GLASS;
  let r2 = dot(n, n);
  let s = sp * (1.0 + CURVE * back * r2 / (1.0 + 0.5 * r2));
  let tuv = s / vec2f(4.0, 3.0) + vec2f(0.5);
  let glassDist = roundBox(s, GLASS, GLASS_R * back);
  if (glassDist > 0.0) {
    // Nothing but black surround until the camera pulls back off the set.
    if (back <= 0.0) {
      return vec4f(0.0, 0.0, 0.0, 1.0);
    }
    let phase = rand01(pcg(u32(in.pos.x) * 1973u + u32(in.pos.y) * 9277u)) * 6.2832;
    return vec4f(cabinet(sp, spillAt(tuv, glassDist, phase), glassDist) * back, 1.0);
  }
  var col = textureSampleLevel(screenTex, samp, tuv, 0.0).rgb;
  // Horizontal Catmull-Rom reconstruction: bilinear is -6 dB at the sample
  // rate's edge, so the upscale reads mushy; the cubic keeps single-sample
  // luma detail crisp (with a hint of authentic edge ringing).
  if (P.crtSharp > 0.0) {
    let w = f32(ACTIVE_W);
    let x = tuv.x * w - 0.5;
    let t = fract(x);
    let x1 = floor(x) + 0.5;
    let p0 = textureSampleLevel(screenTex, samp, vec2f((x1 - 1.0) / w, tuv.y), 0.0).rgb;
    let p1 = textureSampleLevel(screenTex, samp, vec2f(x1 / w, tuv.y), 0.0).rgb;
    let p2 = textureSampleLevel(screenTex, samp, vec2f((x1 + 1.0) / w, tuv.y), 0.0).rgb;
    let p3 = textureSampleLevel(screenTex, samp, vec2f((x1 + 2.0) / w, tuv.y), 0.0).rgb;
    let sharp = p1 + 0.5 * t * (p2 - p0 + t * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3 + t * (3.0 * (p1 - p2) + p3 - p0)));
    col = mix(col, clamp(sharp, vec3f(0.0), vec3f(1.0)), P.crtSharp);
  }
  // Scanline and grille structure can only be drawn while a line still covers
  // more than a screen pixel. Pulled back it does not, and drawing it anyway
  // aliases into moire that crawls with every roll, so both fade out as the
  // picture shrinks past the sampling limit.
  let pxPerLine = 3.0 * scale * zoom / f32(ACTIVE_H);
  let resolved = smoothstep(0.6, 1.4, pxPerLine);
  let fr = fract(tuv.y * f32(ACTIVE_H)) - 0.5;
  // Finite beam spot between scanlines. The spot is space-charge limited, so it
  // grows with beam current: at scanBloom > 0 bright lines fatten until the gaps
  // close in the whites while dim picture keeps thin, separated lines — the
  // signature that makes real scanline structure read as a beam, not an overlay.
  let spot = 1.0 + 3.0 * P.scanBloom * luma(col);
  let beam = 1.0 - resolved * P.scanBeam * (1.0 - exp(-fr * fr * 10.0 / spot));
  col = col * beam;
  // Aperture grille: vertical RGB phosphor stripes, gain-compensated for the
  // mean transmission loss so mids hold while bright areas clip toward white —
  // the highlight desaturation a real tube's bloom gives.
  let maskAmt = P.maskAmt * resolved;
  if (maskAmt > 0.0) {
    // Pitch is authored in canvas pixels at 1:1, but the grille is on the glass,
    // so key it off the glass coordinate: the triads then slide with a pan and
    // fatten with the zoom instead of sitting on the window.
    let gx = tuv.x * 2.0 * half.x;
    let stripe = u32(fract(gx / max(P.maskPitch, 1.5)) * 3.0);
    var m = vec3f(1.0 - maskAmt);
    m[stripe] = 1.0;
    col = col * m / (1.0 - 2.0 * maskAmt / 3.0);
  }
  // Feather the last fraction of a pixel into the bezel, so the rounded tube
  // corners are not a staircase. Only once the set is on show: at 1x and closer
  // the picture meets the letterbox edge-on, as it always has, and this would
  // otherwise soften the outer couple of pixels of every frame.
  let feather = select(1.0, smoothstep(0.0, -0.008, glassDist), back > 0.0);
  return vec4f(col * feather, 1.0);
}
