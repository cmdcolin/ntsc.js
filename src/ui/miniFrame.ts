import type { CSSProperties } from 'react'

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export const MIN_SIZE = 0.1
export const clampSize = (v: number) => Math.min(1, Math.max(MIN_SIZE, v))

// Guides a drag settles onto: edges, center, thirds, quarters.
const GUIDES = [0, 0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1]
const SNAP = 0.012

// Smallest correction that lands one of the dragged reference points on a
// guide — zero when nothing is near, or when the drag asked for precision.
export const snapOffset = (points: number[], on: boolean) => {
  let best = 0
  if (on) {
    let err = SNAP
    for (const p of points) {
      for (const g of GUIDES) {
        if (Math.abs(g - p) < err) {
          err = Math.abs(g - p)
          best = g - p
        }
      }
    }
  }
  return best
}

// Move one edge to `edge` while its opposite stays pinned, in the center/size
// parameters the shader actually reads. s picks which edge moves (-1 or 1).
export const resizeAxis = (
  center: number,
  size: number,
  s: number,
  edge: number,
) => {
  const pinned = center - (s * size) / 2
  const next = clampSize(Math.abs(edge - pinned))
  return { center: clamp01(pinned + (s * next) / 2), size: next }
}

export const uvIn = (el: Element, clientX: number, clientY: number) => {
  const r = el.getBoundingClientRect()
  return {
    u: clamp01((clientX - r.left) / r.width),
    v: clamp01((clientY - r.top) / r.height),
  }
}

export interface WipeShape {
  // Distance function from mix_b.wgsl: B wins where wipePos exceeds it, so the
  // value under the cursor IS the lever position that puts the edge there.
  pos: (u: number, v: number) => number
  region: (p: number) => CSSProperties
}

export const WIPE_SHAPES = new Map<number, WipeShape>([
  [
    1,
    {
      pos: (u: number) => u,
      region: p => ({ left: 0, top: 0, width: pc(p), height: '100%' }),
    },
  ],
  [
    2,
    {
      pos: (_u: number, v: number) => v,
      region: p => ({ left: 0, top: 0, width: '100%', height: pc(p) }),
    },
  ],
  [
    3,
    {
      pos: (u: number, v: number) =>
        Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2,
      region: p => ({
        left: pc(0.5 - p / 2),
        top: pc(0.5 - p / 2),
        width: pc(p),
        height: pc(p),
      }),
    },
  ],
  [
    4,
    {
      pos: (u: number, v: number) => Math.abs(u - 0.5) + Math.abs(v - 0.5),
      region: p => ({
        left: pc(0.5 - p),
        top: pc(0.5 - p),
        width: pc(p * 2),
        height: pc(p * 2),
        clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
      }),
    },
  ],
])

const pc = (v: number) => `${v * 100}%`

// Frame-relative lengths, so the soft edges and matte border drawn on the
// miniature stay in the shader's units whatever width the panel is.
export const cqw = (v: number) => `${v * 100}cqw`
