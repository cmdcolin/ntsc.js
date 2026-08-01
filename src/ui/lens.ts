// The magnifier's geometry, mirrored from present.wgsl so the panel miniature
// and the gestures on the stage aim at the same place the shader looks. Two
// mappings stacked: the 4:3 letterbox puts canvas pixels onto the picture, then
// the lens puts the picture onto the glass.

import { travelToValue, valueToTravel } from './curve'
import { clamp01 } from './miniFrame'

// Below 1x the camera pulls back off the set until the tube is a small object in
// a dark room; above it, in toward the grille.
export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 12

export interface Lens {
  zoom: number
  x: number
  y: number
}

export const clampZoom = (z: number) =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))

// Where 1x — the picture filling the frame — sits along the track. Closing in is
// the everyday move and gets most of the travel; pulling back off the set is one
// gesture you make once, so it lives in the first third.
const DETENT = 0.32

// Magnification along a 0..1 track, with 1x at the detent. Above it the travel
// is spread over view fraction rather than magnification (see curve.ts), so the
// fine control sits where the useful values are: the first fifth covers 1x to
// 1.2x, and only the last sliver goes all the way in. Below it the same curve
// would make one notch a fifth of the way out, so pulling back is a plain linear
// scale — the set simply gets smaller, evenly. Every route (stage slider, panel
// slider, MIDI knob) moves on this scale, so they all feel alike.
export const zoomAtTravel = (t: number) => {
  const p = clamp01(t)
  return clampZoom(
    p < DETENT
      ? ZOOM_MIN + (p / DETENT) * (1 - ZOOM_MIN)
      : travelToValue(1, ZOOM_MAX, (p - DETENT) / (1 - DETENT)),
  )
}

export const zoomTravel = (zoom: number) => {
  const z = clampZoom(zoom)
  return z < 1
    ? (DETENT * (z - ZOOM_MIN)) / (1 - ZOOM_MIN)
    : DETENT + (1 - DETENT) * valueToTravel(1, ZOOM_MAX, z)
}

// What the magnifier covers: at zoom Z the lens sees 1/Z of each axis, and the
// shader holds its centre far enough inside the picture that it never looks past
// the glass. Same clamp here, so both the miniature and the gestures work from
// where the shader actually looks rather than the raw control value.
export const lensView = (zoom: number, x: number, y: number) => {
  // Pulled back the lens holds the whole picture, so there is nothing to aim and
  // the centre is the middle — matching the shader, which pins it there.
  const size = Math.min(1, 1 / clampZoom(zoom))
  const inset = (v: number) => Math.min(1 - size / 2, Math.max(size / 2, v))
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
export const glassAt = (lens: Lens, u: number, v: number) => {
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
    : { zoom: lens.zoom, x: clamp01(view.x - du / z), y: clamp01(view.y - dv / z) }
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
