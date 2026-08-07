import { useEffect, useRef } from 'react'

import styles from './FpsMonitor.module.css'

import type { FrameStats } from '../controls'

// Rolling histogram of recent per-window fps, sat in the sidebar masthead. It
// used to float over the bottom-left of the picture, which is the one place in
// the app that is supposed to stay clear. Whether it is on at all is the app's
// state, not this component's — the stage menu has the other switch — and it
// starts off, because a number that moves every frame pulls the eye whatever
// corner it is in. Each bar is one stats window; a dip below the 60/30 fps
// reference lines shows a stall the averaged number alone would smooth over.
// Scaled to a 65 fps ceiling so a healthy signal nearly fills the bar and any
// shortfall reads as a gap at the top.
const HISTORY = 60
const SCALE_FPS = 65
const GOOD_FPS = 60
const OK_FPS = 30

// Color judges the rate the loop could reach unlocked (fps x lock): a lock
// holding a steady 24 on a 48 Hz panel is the lock working, not a stall, and
// painting it red would send someone hunting a slowdown they asked for. Bar
// height stays the presented rate — that is what the eye is getting.
function barColor(fps: number, lock: number): string {
  const effective = fps * lock
  return effective >= 55 ? '#4a4' : effective >= 28 ? '#cc4' : '#e55'
}

// The lock divisor as the marker the readout shows beside the number.
const LOCK_MARK: Record<number, string> = { 2: '½', 3: '⅓', 4: '¼' }

function draw(canvas: HTMLCanvasElement, history: [number, number][]) {
  const dpr = Math.min(window.devicePixelRatio, 2)
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  const ctx = canvas.getContext('2d')
  if (ctx !== null) {
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(0, 0, w, h)
    // 60 fps and 30 fps reference lines
    for (const ref of [GOOD_FPS, OK_FPS]) {
      const y = h - (ref / SCALE_FPS) * h
      ctx.strokeStyle = 'rgba(200,200,208,0.25)'
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }
    const bw = w / HISTORY
    history.forEach(([fps, lock], i) => {
      const bh = (Math.min(fps, SCALE_FPS) / SCALE_FPS) * h
      ctx.fillStyle = barColor(fps, lock)
      ctx.fillRect(i * bw, h - bh, Math.max(bw - 0.5, 1), bh)
    })
  }
}

export function FpsMonitor(props: {
  stats: FrameStats
  res: string
  onHide: () => void
}) {
  const { fps, lock } = props.stats
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const historyRef = useRef<[number, number][]>([])

  // Each new stats object is one window sample; append and redraw the histogram.
  useEffect(() => {
    historyRef.current = [
      ...historyRef.current,
      [fps, lock] as [number, number],
    ].slice(-HISTORY)
    const canvas = canvasRef.current
    if (canvas !== null) draw(canvas, historyRef.current)
  }, [fps, lock])

  // The lock marker beside the number is what tells a halved readout apart
  // from a stall: 24 ·½ is the frame lock holding cadence on purpose.
  const mark = LOCK_MARK[lock]
  // The render resolution rides in the tooltip rather than the line: it is a
  // number you go looking for once, and spelling it out here is what made this
  // too wide for the header. Advanced settings shows it beside its own control.
  return (
    <div
      className={styles.monitor}
      title={`${fps.toFixed(0)} presented fps${mark === undefined ? '' : ` · frame lock at ${mark} rate`} · rendering at ${props.res}`}
    >
      <canvas ref={canvasRef} className={styles.graph} />
      <span className={styles.readout}>
        {fps.toFixed(0)} fps{mark === undefined ? '' : ` ·${mark}`}
      </span>
      <button
        className={styles.dismiss}
        onClick={() => props.onHide()}
        title="hide the fps monitor — the stage menu brings it back"
      >
        ×
      </button>
    </div>
  )
}
