import { useEffect, useRef, useState } from 'react'
import type { FrameStats } from '../gpu/pipeline'
import styles from './FpsMonitor.module.css'

// Rolling history of per-window worst-frame times, drawn as a sparkline so a
// freeze shows up as a spike the averaged fps number hides. Fixed 100 ms scale
// keeps healthy frames readable; anything longer clamps to the top and the
// numeric worst readout carries the true magnitude.
const HISTORY = 120 // ~1 min at one sample per 30 frames
const SCALE_MS = 100
const GOOD_MS = 1000 / 60 // 16.7 — one frame at 60 fps
const OK_MS = 1000 / 30 // 33.3 — one frame at 30 fps

function barColor(ms: number): string {
  return ms < 20 ? '#4a4' : ms < 40 ? '#cc4' : '#e55'
}

function draw(canvas: HTMLCanvasElement, history: number[]) {
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
    for (const ref of [GOOD_MS, OK_MS]) {
      const y = h - (Math.min(ref, SCALE_MS) / SCALE_MS) * h
      ctx.strokeStyle = 'rgba(200,200,208,0.25)'
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }
    const bw = w / HISTORY
    history.forEach((ms, i) => {
      const bh = Math.min(ms, SCALE_MS) / SCALE_MS * h
      ctx.fillStyle = barColor(ms)
      ctx.fillRect(i * bw, h - bh, Math.max(bw - 0.5, 1), bh)
    })
  }
}

export function FpsMonitor(props: { stats: FrameStats; res: string }) {
  const { fps, worstMs } = props.stats
  const [open, setOpen] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const historyRef = useRef<number[]>([])

  // Each new stats object is one window sample; append and redraw the graph.
  useEffect(() => {
    historyRef.current = [...historyRef.current, worstMs].slice(-HISTORY)
    const canvas = canvasRef.current
    if (open && canvas !== null) draw(canvas, historyRef.current)
  }, [worstMs, open])

  return (
    <div className={styles.monitor}>
      <button
        className={styles.readout}
        onClick={() => setOpen(o => !o)}
        title="toggle frame-time graph"
      >
        {fps.toFixed(0)} fps · worst {worstMs.toFixed(0)}ms · {props.res}
      </button>
      {open ? <canvas ref={canvasRef} className={styles.graph} /> : null}
    </div>
  )
}
