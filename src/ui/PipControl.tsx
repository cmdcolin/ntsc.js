import { useControls, useControlsApi } from './ControlsContext'
import { PipFrame } from './PipFrame'

// The inset window, bound to the store.
//
// Its own module rather than a local in ControlGroup because two places put the
// same window on screen now: the PiP stage, where it stands in for four sliders,
// and the deck, where it is the joystick pad that stage's geometry always
// wanted to be. One component, so the two can't drift into two windows that
// behave differently.
export function PipControl() {
  const controls = useControls()
  const { writeControl, writeControls } = useControlsApi()
  return (
    <PipFrame
      inert={controls.pipMix === 0}
      onFix={() => writeControl('pipMix', 0.7)}
      border={controls.pipBorder}
      soft={controls.pipSoft}
      box={{
        x: controls.pipX,
        y: controls.pipY,
        w: controls.pipW,
        h: controls.pipH,
      }}
      // One write, not four: a drag moves all four at once, so the engine
      // notifies (and React renders) once per pointer move.
      onChange={box =>
        writeControls({
          ...controls,
          pipX: box.x,
          pipY: box.y,
          pipW: box.w,
          pipH: box.h,
        })
      }
    />
  )
}
