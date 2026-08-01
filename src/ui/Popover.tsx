import { useEffect, useRef, useState } from 'react'

import styles from './Popover.module.css'

import type { ReactNode } from 'react'

// Generic click-to-open menu anchored to its trigger. Closes on outside
// pointerdown or when a menu item calls the close callback it's handed.
export function Popover(props: {
  trigger: (toggle: () => void) => ReactNode
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // An effect's cleanup return is conditional by nature (React's own documented pattern).
  // oxlint-disable-next-line typescript/consistent-return
  useEffect(() => {
    const doc = wrapRef.current?.ownerDocument
    if (open && doc !== undefined) {
      const onPointerDown = (e: PointerEvent) => {
        const inside =
          e.target instanceof Node &&
          (wrapRef.current?.contains(e.target) ?? false)
        if (!inside) setOpen(false)
      }
      doc.addEventListener('pointerdown', onPointerDown)
      return () => doc.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  return (
    <div className={styles.wrap} ref={wrapRef}>
      {props.trigger(() => setOpen(o => !o))}
      {open && (
        <div className={styles.menu}>
          {props.children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
