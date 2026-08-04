// The docs site: renders the reader-facing markdown into static pages under
// dist/guide/, which GitHub Pages then serves beside the app at /guide/.
//
// Run by `pnpm build` after vite, or on its own with `node scripts/build-guide.mjs`
// (add --out=DIR to render somewhere else).
//
// The markdown files stay the source of truth and stay readable on GitHub: the
// only thing added here is what a static site needs and a repo view can't have —
// a nav across the pages, and an "open this in the app" link under every figure
// captured by scripts/docshots.mjs (matched by filename through docs/img/shots.json).

import MarkdownIt from 'markdown-it'

import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, posix } from 'node:path'

const outArg = process.argv.find(a => a.startsWith('--out='))
const outDir = outArg === undefined ? 'dist/guide' : outArg.slice(6)

const PAGES = [
  { file: 'docs/USER-GUIDE.md', out: 'index.html', nav: 'User guide' },
  {
    file: 'docs/HOW-IT-WORKS.md',
    out: 'how-it-works.html',
    nav: 'How it works',
  },
  { file: 'docs/EFFECTS.md', out: 'effects.html', nav: 'Effects' },
  { file: 'docs/MIDI.md', out: 'midi.html', nav: 'MIDI' },
  // Contributor-facing, but it holds the diagrams for the three domains and for
  // adding a control, which are the two things hardest to pick up from the code.
  {
    file: 'docs/ARCHITECTURE.md',
    out: 'architecture.html',
    nav: 'Architecture',
  },
]

// Markdown link -> where it goes on the site. Anything else that ends in .md is
// a contributor doc with no page here, so it goes to the repo.
const REPO = 'https://github.com/cmdcolin/ntsc.js/blob/main/'
const LINKS = new Map([
  ['USER-GUIDE.md', 'index.html'],
  ['HOW-IT-WORKS.md', 'how-it-works.html'],
  ['EFFECTS.md', 'effects.html'],
  ['MIDI.md', 'midi.html'],
  ['ARCHITECTURE.md', 'architecture.html'],
])

const slug = text =>
  text
    .toLowerCase()
    .replaceAll(/[^\da-z -]/g, '')
    .trim()
    .replaceAll(' ', '-')

const md = new MarkdownIt({ html: true, linkify: true, typographer: false })

// Headings get GitHub's anchor ids, so the in-page links the markdown already
// carries (EFFECTS.md leads with a table of them) work here too.
md.renderer.rules.heading_open = (tokens, i, opts, _env, self) => {
  const text = tokens[i + 1].content
  tokens[i].attrSet('id', slug(text))
  return self.renderToken(tokens, i, opts)
}

// Repoint cross-document links at the site's own pages. Paths are relative and
// vary by where the source file sits (docs/EFFECTS.md vs ../EFFECTS.md), so
// match on the basename; anything else relative is a file with no page here
// (a contributor doc, a script) and goes to the repo, resolved from the source
// file's own directory so `../scripts/x.mjs` lands on `scripts/x.mjs`.
const rewriteLink = (href, dir) => {
  const [path, hash] = href.split('#')
  const page = LINKS.get(basename(path))
  const anchor = hash === undefined ? '' : `#${hash}`
  return href.startsWith('http') ||
    href.startsWith('#') ||
    path.startsWith('img/')
    ? href
    : page !== undefined
      ? page + anchor
      : REPO + posix.normalize(posix.join(dir, path))
}
const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, i, opts, _env, self) => self.renderToken(tokens, i, opts))
md.renderer.rules.link_open = (tokens, i, opts, env, self) => {
  const href = tokens[i].attrGet('href')
  if (href !== null) tokens[i].attrSet('href', rewriteLink(href, env.dir))
  return defaultLinkOpen(tokens, i, opts, env, self)
}

// The live URL for each captured figure, keyed by the image file it produced.
const shots = new Map(
  JSON.parse(readFileSync('docs/img/shots.json', 'utf8')).map(s => [
    s.file,
    s.live,
  ]),
)

// A figure whose image came from a spec gets the session that produced it as a
// link — the reader can open the exact state in the screenshot and move the
// sliders. Nothing to maintain: the URL is the spec's own params.
const withLiveLinks = html =>
  html.replaceAll(/<img src="img\/([^"]+)"([^>]*)>/g, (whole, file, rest) => {
    const live = shots.get(file)
    return live === undefined
      ? whole
      : `<figure><img src="img/${file}"${rest}>` +
          `<figcaption><a href="${live}">open this in the app ↗</a></figcaption></figure>`
  })

// The markdown ships each Graphviz diagram as a <picture> so GitHub can serve a
// light or dark SVG per the reader's OS. This site has one theme and it is dark,
// so honouring prefers-color-scheme here would hand a light-mode visitor pale
// pastel diagrams on a near-black page. Collapse to the dark source instead.
const forceDarkDiagrams = html =>
  html.replaceAll(
    /<picture>\s*<source media="\(prefers-color-scheme: dark\)" srcset="([^"]+)">\s*<img ([^>]*?)src="[^"]+"([^>]*)>\s*<\/picture>/g,
    (_whole, dark, before, after) => `<img ${before}src="${dark}"${after}>`,
  )

const page = (body, title, current) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — ntsc.js</title>
<link rel="icon" type="image/svg+xml" href="../favicon.svg">
<style>
:root {
  --fg: #e6e6ee; --fg2: #c6c6d6; --fg3: #a6a6ba; --fg4: #85859a;
  --bg: #0e0e11; --card: #16161a; --border: #2e2e38; --accent: #7fd0a0;
  --mono: ui-monospace, 'SF Mono', Menlo, monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg); line-height: 1.6;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 16px;
}
header {
  position: sticky; top: 0; z-index: 10; display: flex; flex-wrap: wrap;
  gap: 4px 18px; align-items: center; padding: 10px 24px;
  background: rgba(14, 14, 17, 0.92); backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border);
}
header .brand { font-weight: 700; letter-spacing: 0.02em; margin-right: 8px; }
header a { color: var(--fg3); text-decoration: none; font-size: 14px; }
header a:hover { color: var(--fg); }
header a.on { color: var(--accent); }
header .app { margin-left: auto; color: var(--accent); }
main { max-width: 900px; margin: 0 auto; padding: 8px 24px 96px; }
h1 { font-size: 34px; line-height: 1.2; margin: 32px 0 8px; }
h2 {
  font-size: 24px; margin: 48px 0 8px; padding-top: 12px;
  border-top: 1px solid var(--border);
}
h3 { font-size: 18px; margin: 28px 0 4px; color: var(--fg2); }
p, li { color: var(--fg2); }
a { color: var(--accent); }
code {
  font-family: var(--mono); font-size: 0.88em; background: var(--card);
  border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px;
}
pre {
  background: var(--card); border: 1px solid var(--border); border-radius: 6px;
  padding: 12px 14px; overflow-x: auto;
}
pre code { background: none; border: 0; padding: 0; }
blockquote {
  margin: 16px 0; padding: 2px 16px; border-left: 3px solid var(--border);
  color: var(--fg3);
}
img, video { max-width: 100%; height: auto; border-radius: 6px; }
figure { margin: 24px 0; }
figure img { display: block; border: 1px solid var(--border); }
figcaption { margin-top: 6px; font-size: 13px; color: var(--fg4); }
video { border: 1px solid var(--border); display: block; margin: 24px 0; }
table { border-collapse: collapse; width: 100%; margin: 20px 0; font-size: 15px; }
th, td { border: 1px solid var(--border); padding: 7px 10px; text-align: left; vertical-align: top; }
th { background: var(--card); color: var(--fg); }
kbd {
  font-family: var(--mono); font-size: 12px; background: var(--card);
  border: 1px solid var(--fg4); border-bottom-width: 2px; border-radius: 4px;
  padding: 1px 6px;
}
sub, sup { color: var(--fg4); }
hr { border: 0; border-top: 1px solid var(--border); margin: 40px 0; }
</style>
</head>
<body>
<header>
  <span class="brand">ntsc.js</span>
  ${PAGES.map(p => `<a class="${p.out === current ? 'on' : ''}" href="${p.out}">${p.nav}</a>`).join('\n  ')}
  <a class="app" href="../">open the app ↗</a>
</header>
<main>
${body}
</main>
</body>
</html>
`

mkdirSync(join(outDir, 'img'), { recursive: true })
for (const file of readdirSync('docs/img')) {
  copyFileSync(join('docs/img', file), join(outDir, 'img', file))
}
for (const spec of PAGES) {
  const body = forceDarkDiagrams(
    withLiveLinks(
      md.render(readFileSync(spec.file, 'utf8'), { dir: dirname(spec.file) }),
    ),
  )
  writeFileSync(join(outDir, spec.out), page(body, spec.nav, spec.out))
  console.log(`  ✓ ${join(outDir, spec.out)}`)
}
