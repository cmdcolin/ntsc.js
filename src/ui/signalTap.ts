// The decode-stage taps: what the set is working with part way through, drawn
// on the glass instead of the finished picture. The values are the `dbgView`
// uniform's, read by decode.wgsl — 1 is present.wgsl's own gradient test and is
// deliberately not offered, since it says nothing about the signal.
//
// Two surfaces show this list — the Advanced dialog, which explains it, and the
// stage menu, which is where you reach for it while looking at the picture — so
// it lives here rather than inside either of them.

export interface SignalTap {
  value: number
  // For the dialog's picker, where there is room to say what it is.
  label: string
  // For the stage: the badge on the menu trigger, and the menu's own row. Short
  // enough to sit next to a zoom readout.
  short: string
}

export const SIGNAL_TAPS: SignalTap[] = [
  { value: 0, label: 'off — decoded picture', short: 'picture' },
  { value: 2, label: 'composite waveform', short: 'waveform' },
  { value: 3, label: 'luma channel', short: 'luma' },
  { value: 4, label: 'chroma (U/V energy)', short: 'chroma' },
  { value: 5, label: 'burst / decoder state', short: 'burst' },
]

// `?dbg=` can name any number, including one no tap uses, so this is a lookup
// that reports what it found rather than an assertion that it found something.
export const tapFor = (value: number): SignalTap =>
  SIGNAL_TAPS.find(t => t.value === value) ?? SIGNAL_TAPS[0]

// The next tap along, wrapping — what one menu row steps through, so cycling
// the taps needs no picker of its own. A value no tap uses steps to the first,
// which is the decoded picture: whatever `?dbg=` was set to, one press comes
// back to something recognisable.
export const nextTap = (value: number): number => {
  const at = SIGNAL_TAPS.findIndex(t => t.value === value)
  return SIGNAL_TAPS[at === -1 ? 0 : (at + 1) % SIGNAL_TAPS.length].value
}
