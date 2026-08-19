// The magnifier's geometry, mirrored from present.wgsl so the panel miniature
// and the gestures on the stage aim at the same place the shader looks. Two
// mappings stacked: the 4:3 letterbox puts canvas pixels onto the picture, then
// the lens puts the picture onto the glass.

import { clamp, clamp01 } from '../core/math'
import { travelToValue, valueToTravel } from './curve'

// Below 1x the camera pulls back off the set until the tube is a small object in
// a dark room (present.wgsl draws the cabinet down there). No travel control —
// stage slider, panel slider, MIDI knob — can reach it, so ZOOM_MIN bounds only
// presets and gestures, not travel.
//
// Nothing in the app aims there any more: it used to be one preset's whole
// point ('across the room'), and that preset is gone. The floor stays where it
// is because a link still carries raw control values, so `?set=crtZoom:0.42`
// and any saved look built back when the chip existed still land in the room
// rather than being clamped to the glass.
const ZOOM_MIN = 0.25
export const ZOOM_MAX = 12

export interface Lens {
  zoom: number
  x: number
  y: number
}

export const clampZoom = (z: number) => clamp(z, ZOOM_MIN, ZOOM_MAX)

// Magnification along a 0..1 track, 1x..ZOOM_MAX. Travel is spread over view
// fraction rather than magnification (see curve.ts), so the fine control sits
// where the useful values are: the first fifth covers 1x to 1.2x, and only the
// last sliver goes all the way in.
export const zoomAtTravel = (t: number) =>
  clampZoom(travelToValue(1, ZOOM_MAX, clamp01(t)))

// A zoom below 1x has no travel position — it parks at the low end, same as
// dragging the slider all the way down would if it could reach that far.
export const zoomTravel = (zoom: number) => {
  const z = clampZoom(zoom)
  return z < 1 ? 0 : valueToTravel(1, ZOOM_MAX, z)
}

// What the magnifier covers: at zoom Z the lens sees 1/Z of each axis, and the
// shader holds its centre far enough inside the picture that it never looks past
// the glass. Same clamp here, so both the miniature and the gestures work from
// where the shader actually looks rather than the raw control value.
export const lensView = (zoom: number, x: number, y: number) => {
  // Pulled back the lens holds the whole picture, so there is nothing to aim and
  // the centre is the middle — matching the shader, which pins it there.
  const size = Math.min(1, 1 / clampZoom(zoom))
  const inset = (v: number) => clamp(v, size / 2, 1 - size / 2)
  return { size, x: inset(x), y: inset(y) }
}

// Where in the picture a canvas point lands, in the 0..1 the shader reads.
// Outside 0..1 is the black surround beside a 4:3 picture in a wider window.
export const pictureUv = (
  size: { width: number; height: number },
  px: number,
  py: number,
) => {
  const scale = Math.min(size.width / 4, size.height / 3)
  return {
    u: (px - size.width / 2) / (4 * scale) + 0.5,
    v: (py - size.height / 2) / (3 * scale) + 0.5,
  }
}

// The point on the glass currently showing at a point in the picture.
const glassAt = (lens: Lens, u: number, v: number) => {
  const view = lensView(lens.zoom, lens.x, lens.y)
  const z = clampZoom(lens.zoom)
  return {
    x: (u - view.x) / z + view.x,
    y: (v - view.y) / z + view.y,
  }
}

// Drag the glass under a fixed lens: the picture follows the pointer, so the
// lens travels the opposite way, and by less the deeper the magnification. Only
// meaningful magnified — pulled back, the whole picture is already in view.
export const panLens = (lens: Lens, du: number, dv: number): Lens => {
  const view = lensView(lens.zoom, lens.x, lens.y)
  const z = clampZoom(lens.zoom)
  return z <= 1
    ? lens
    : {
        zoom: lens.zoom,
        x: clamp01(view.x - du / z),
        y: clamp01(view.y - dv / z),
      }
}

// A box dragged on the panel miniature, whose frame IS the whole glass however
// far the lens is currently in. So the box states the view outright — how much
// of the picture to keep, and which part — rather than compounding on what is
// already magnified the way a box on the stage does. The longer edge decides
// here too, so everything drawn inside the box stays visible.
export const boxToLens = (
  a: { u: number; v: number },
  b: { u: number; v: number },
): Lens => {
  const covered = Math.max(Math.abs(b.u - a.u), Math.abs(b.v - a.v))
  return {
    zoom: clampZoom(1 / covered),
    x: (a.u + b.u) / 2,
    y: (a.v + b.v) / 2,
  }
}

// A dragged box on the picture becomes the new view: magnify by however much of
// the picture the box covers, and look at what was inside it. The longer edge
// decides, so everything drawn stays visible.
export const zoomToBox = (
  lens: Lens,
  a: { u: number; v: number },
  b: { u: number; v: number },
): Lens => {
  const covered = Math.max(Math.abs(b.u - a.u), Math.abs(b.v - a.v))
  const g = glassAt(lens, (a.u + b.u) / 2, (a.v + b.v) / 2)
  return { zoom: clampZoom(clampZoom(lens.zoom) / covered), x: g.x, y: g.y }
}
