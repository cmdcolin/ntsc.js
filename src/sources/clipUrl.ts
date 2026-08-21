// A compact caption for a URL handed to yt-dlp. YouTube gets its video id,
// which is the part anyone recognises; every other site gets host and last path
// segment, because the whole address is longer than the caption row.
const siteLabel = (url: string): string => {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    const last = u.pathname
      .split('/')
      .filter(s => s !== '')
      .at(-1)
    return last === undefined ? host : `${host}/${last}`
  } catch {
    return url
  }
}

export const clipLabel = (url: string): string => {
  const watch = /youtube(?:-nocookie)?\.com\/watch\?(?:.*&)?v=([\w-]+)/.exec(
    url,
  )
  const short = /youtu\.be\/([\w-]+)/.exec(url)
  return watch?.[1] ?? short?.[1] ?? siteLabel(url)
}
