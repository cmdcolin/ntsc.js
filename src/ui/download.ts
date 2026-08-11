// Handing a file to the user, and what to call it.
//
// Two things save files now — the live recorder (`useCapture`) and the offline
// render (`useRender`) — and they have to agree on the name, because a folder
// holding both is a folder somebody is trying to sort by time.

const pad2 = (n: number) => String(n).padStart(2, '0')

// yyyymmdd-hhmmss, so saved files sort chronologically and never collide.
function stamp(): string {
  const d = new Date()
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
}

export function fileName(name: string, ext: string): string {
  const slug = name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
  return `ntsc.js-${slug}-${stamp()}.${ext}`
}

export function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
