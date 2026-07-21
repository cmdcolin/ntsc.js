// The video id from a YouTube URL, for a compact source label. Handles both
// watch?v=ID and youtu.be/ID forms; falls back to the raw string otherwise.
export const ytId = (url: string): string => {
  const query = /[?&]v=([\w-]+)/.exec(url)
  const short = /youtu\.be\/([\w-]+)/.exec(url)
  return query?.[1] ?? short?.[1] ?? url
}
