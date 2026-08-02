import { Dialog } from './Dialog'
import { formatValue } from './format'
import ui from './ui.module.css'

// The "what does this knob actually do" card behind every slider's ? icon.
// Rendered from inside the slider, so it lands in whichever document the panel
// lives in (main window or popout).
export function SliderHelpDialog(props: {
  label: string
  help: string
  min: number
  max: number
  step: number
  defaultValue: number
  unit: string
  onClose: () => void
}) {
  const fmt = (v: number) =>
    `${formatValue(v, props.step)}${props.unit === '' ? '' : ` ${props.unit}`}`
  return (
    <Dialog title={props.label} size="prose" onClose={props.onClose}>
      <p className={ui.helpText}>{props.help}</p>
      <div className={ui.muted}>
        range {fmt(props.min)} … {fmt(props.max)} · default{' '}
        {fmt(props.defaultValue)}
      </div>
    </Dialog>
  )
}
