// The structure inside a help string, without the React that renders it.
//
// The ~140 control blurbs are strings in `controls.ts`, read by exactly two
// surfaces — the hover card on a slider's ? and the dialog behind clicking it —
// so the choice was between changing every call site to take a ReactNode and
// teaching those two readers a convention. The convention is far smaller, and
// it keeps the copy a writer edits looking like the copy a reader gets:
//
//   a blank line   starts a new paragraph
//   a "- " line    is a bullet
//   **term**       is bold — on a mode switch, the position being described
//   `x`            is code: a key chord, a URL parameter, a literal value
//
// That is the whole of it. A blurb using none of it renders exactly as it did,
// which is why this could go in under 140 unconverted strings.
//
// What it is for: a mode switch's help has to say what each position does, and
// as one paragraph the positions hide inside the prose — the reader is looking
// for `scrub` and has to read a wall to find out whether it is in there. As
// four bullets the answer is where the eye already is.

// A run of lines that renders as one thing. A line opening with "- " starts an
// item; a line that does not, inside a list, is that item continuing — so a
// long bullet can be wrapped in the source without becoming two bullets.
export type HelpBlock = { list: boolean; items: string[] }

export function helpBlocks(text: string): HelpBlock[] {
  const out: HelpBlock[] = []
  for (const para of text.trim().split(/\n\s*\n/)) {
    for (const line of para.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      const bullet = trimmed.startsWith('- ')
      const open = out.at(-1)
      if (bullet) {
        const item = trimmed.slice(2)
        if (open?.list === true) open.items.push(item)
        else out.push({ list: true, items: [item] })
      } else if (open === undefined || open.items.length === 0) {
        out.push({ list: false, items: [trimmed] })
      } else {
        // Continuation of whatever is open, list item or paragraph alike.
        open.items[open.items.length - 1] += ` ${trimmed}`
      }
    }
    // A blank line closes the block, so the next paragraph cannot be swallowed
    // as a continuation of the last bullet.
    out.push({ list: false, items: [] })
  }
  return out.filter(b => b.items.length > 0)
}
