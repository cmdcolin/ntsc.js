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
  // The landing page is the short one: what this is, four steps, a picture of
  // the panel. Everything that used to be on it lives in the user guide.
  {
    file: 'docs/GETTING-STARTED.md',
    out: 'index.html',
    nav: 'Getting started',
  },
  { file: 'docs/USER-GUIDE.md', out: 'guide.html', nav: 'User guide' },
  {
    file: 'docs/HOW-IT-WORKS.md',
    out: 'how-it-works.html',
    nav: 'How it works',
  },
  { file: 'docs/EFFECTS.md', out: 'effects.html', nav: 'Effects & features' },
  { file: 'docs/MIDI.md', out: 'midi.html', nav: 'MIDI' },
  // Where this sits among the other analog-video tools, including the cases
  // where one of them is the better answer. Reader-facing: it is the page
  // someone arriving from a search wants before any of the others.
  { file: 'docs/COMPARISON.md', out: 'comparison.html', nav: 'Comparison' },
  // ARCHITECTURE.md is deliberately not here. It is contributor material, and
  // a reader's nav is the wrong place for it; the part of it a reader wants —
  // the signal path and the three domains — is in HOW-IT-WORKS.md, and links to
  // it fall through to the repo like any other contributor doc.
]

// Markdown link -> where it goes on the site. Anything else that ends in .md is
// a contributor doc with no page here, so it goes to the repo.
const REPO = 'https://github.com/cmdcolin/ntsc.js/blob/main/'
const LINKS = new Map([
  ['GETTING-STARTED.md', 'index.html'],
  ['USER-GUIDE.md', 'guide.html'],
  ['HOW-IT-WORKS.md', 'how-it-works.html'],
  // Merged into the effects page: what the app can do and what it can break
  // were two lists of the same things.
  ['FEATURES.md', 'effects.html'],
  ['EFFECTS.md', 'effects.html'],
  ['MIDI.md', 'midi.html'],
  ['COMPARISON.md', 'comparison.html'],
])

const slug = text =>
  text
    .toLowerCase()
    .replaceAll(/[^\da-z -]/g, '')
    .trim()
    .replaceAll(' ', '-')

const md = new MarkdownIt({ html: true, linkify: true, typographer: false })

// Headings get GitHub's anchor ids, so the in-page links the markdown already
// carries (EFFECTS.md leads with a table of them) work here too. The same pass
// records the h2/h3 outline in `env`, which is what the page's "on this page"
// nav is built from — derived, so a heading added to the markdown shows up
// there without anyone maintaining a second list.
md.renderer.rules.heading_open = (tokens, i, opts, env, self) => {
  const text = tokens[i + 1].content
  const id = slug(text)
  tokens[i].attrSet('id', id)
  const level = Number(tokens[i].tag.slice(1))
  if (level === 2 || level === 3) env.headings.push({ level, id, text })
  return self.renderToken(tokens, i, opts)
}

// A "#" after each h2/h3 that appears on hover or keyboard focus: the anchors
// already exist, this is the only way a reader finds out they can be linked to.
md.renderer.rules.heading_close = (tokens, i, opts, _env, self) => {
  const level = Number(tokens[i].tag.slice(1))
  const link =
    level === 2 || level === 3
      ? `<a class="anchor" href="#${slug(tokens[i - 1].content)}" aria-label="Permalink to this section">#</a>`
      : ''
  return link + self.renderToken(tokens, i, opts)
}

// Wide tables get a scroll container of their own rather than squeezing their
// columns down to two words a line, which is what the phone width did to the
// stage table on the effects page.
md.renderer.rules.table_open = () => '<div class="tablewrap"><table>'
md.renderer.rules.table_close = () => '</table></div>'

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

const SITE = 'https://cmdcolin.github.io/ntsc.js/'

const esc = s =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')

// Every page's first paragraph is already a summary of it, so it is also the
// meta description and the text a shared link unfurls with. Nothing to write
// twice, and nothing to leave stale. Cut on a sentence where there is one,
// since a description that stops mid-clause reads as broken.
const summarise = html => {
  const first = /<p>([\s\S]*?)<\/p>/.exec(html)
  if (first === null) return ''
  const text = first[1]
    .replaceAll(/<[^>]+>/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim()
  if (text.length <= 200) return text
  const head = text.slice(0, 200)
  const stop = head.lastIndexOf('. ')
  return stop > 80
    ? head.slice(0, stop + 1)
    : `${head.slice(0, head.lastIndexOf(' ')).trimEnd()}…`
}

// The site's own landing page is the directory, not the filename.
const url = out => `${SITE}guide/${out === 'index.html' ? '' : out}`

// Short pages don't get a section nav — four sections you can see by scrolling
// are not worth one — but the effects page is 25,000 pixels tall on a phone and
// the user guide is not far behind.
const NAV_MIN = 5

// "On this page", built from the outline the heading rule collected.
const tocFor = headings =>
  headings.length < NAV_MIN
    ? ''
    : `<details class="toc">
<summary>On this page</summary>
<nav aria-label="On this page">
${headings
  .map(h => `<a class="l${h.level}" href="#${h.id}">${esc(h.text)}</a>`)
  .join('\n')}
</nav>
</details>`

// Previous / next across PAGES, so the site reads as a sequence rather than six
// unrelated documents. On a phone this is also the way back to the nav without
// scrolling to the top: the header does not stick down there.
const pagerFor = current => {
  const i = PAGES.findIndex(p => p.out === current)
  const link = (spec, rel, label) =>
    spec === undefined
      ? '<span></span>'
      : `<a class="${rel}" href="${spec.out}"><span>${label}</span><b>${spec.nav}</b></a>`
  return `<nav class="pager" aria-label="Pages">
${link(PAGES[i - 1], 'prev', '← Previous')}
${link(PAGES[i + 1], 'next', 'Next →')}
</nav>`
}

const page = (body, title, current, headings) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title} — ntsc.js</title>
<meta name="description" content="${esc(summarise(body))}">
<link rel="canonical" href="${url(current)}">
<link rel="icon" type="image/svg+xml" href="../favicon.svg">
<meta name="theme-color" content="#0e0e11">
<meta name="color-scheme" content="dark">
<!-- A guide page shared on its own unfurls as itself, not as a bare filename. -->
<meta property="og:type" content="article">
<meta property="og:site_name" content="ntsc.js">
<meta property="og:url" content="${url(current)}">
<meta property="og:title" content="${esc(title)} — ntsc.js">
<meta property="og:description" content="${esc(summarise(body))}">
<meta property="og:image" content="${SITE}og.jpg">
<meta name="twitter:card" content="summary_large_image">
<style>
:root {
  --fg: #e6e6ee; --fg2: #c6c6d6; --fg3: #a6a6ba; --fg4: #85859a;
  --bg: #0e0e11; --card: #16161a; --border: #2e2e38; --accent: #7fd0a0;
  --mono: ui-monospace, 'SF Mono', Menlo, monospace;
  /* The reading column, and the gutter the section nav sits in beside it. */
  --measure: 45rem; --aside: 15rem; --gap: 3rem;
  --bar: 3.25rem;
}
* { box-sizing: border-box; min-width: 0; }
html { scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
body {
  margin: 0; background: var(--bg); color: var(--fg); line-height: 1.65;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 16px; -webkit-text-size-adjust: 100%;
}
:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 2px; }
::selection { background: rgba(127, 208, 160, 0.28); }

.skip {
  position: absolute; left: 8px; top: -3rem; z-index: 20; padding: 8px 14px;
  background: var(--card); border: 1px solid var(--accent); border-radius: 6px;
  color: var(--accent); text-decoration: none; transition: top 0.15s;
}
.skip:focus { top: 8px; }

/* ── header ────────────────────────────────────────────────────────────────
   Two rows on a phone (identity + call to action, then the page links as one
   scrolling line) and one row from tablet up. It only sticks where there is
   vertical room to spare: on a phone a sticky bar cost three wrapped rows of
   an 844px screen, and the section nav and the pager cover what it was for. */
header { border-bottom: 1px solid var(--border); background: var(--bg); }
.bar {
  max-width: calc(var(--measure) + var(--aside) + var(--gap)); margin: 0 auto;
  display: flex; align-items: center; gap: 10px 20px; flex-wrap: wrap;
  padding: 10px max(1.15rem, env(safe-area-inset-left)) 0;
}
.brand {
  font-weight: 700; letter-spacing: 0.01em; color: var(--fg);
  text-decoration: none; margin-right: auto; font-size: 17px;
}
.brand span {
  color: var(--fg4); font-weight: 400; margin-left: 7px; font-size: 14px;
}
.cta {
  color: var(--accent); text-decoration: none; font-size: 14px; font-weight: 600;
  border: 1px solid rgba(127, 208, 160, 0.45); border-radius: 999px;
  padding: 4px 13px; white-space: nowrap; background: rgba(127, 208, 160, 0.07);
}
.cta:hover { background: rgba(127, 208, 160, 0.16); }
/* order 1 keeps the links below the identity row while the bar wraps, so the
   phone header is two rows rather than the three the old one wrapped into. */
.pages {
  display: flex; gap: 22px; width: 100%; order: 1; overflow-x: auto;
  padding: 4px 0 0; scrollbar-width: none; -webkit-overflow-scrolling: touch;
  mask-image: linear-gradient(90deg, #000 calc(100% - 28px), transparent);
}
.pages::-webkit-scrollbar { display: none; }
.pages a {
  color: var(--fg3); text-decoration: none; font-size: 14px; white-space: nowrap;
  padding: 6px 0 9px; border-bottom: 2px solid transparent;
  flex: none; /* or they shrink past their own text and overlap */
}
.pages a:hover { color: var(--fg); }
.pages a.on { color: var(--accent); border-bottom-color: var(--accent); }

/* ── layout ─────────────────────────────────────────────────────────────── */
.wrap {
  max-width: calc(var(--measure) + var(--aside) + var(--gap)); margin: 0 auto;
  padding: 0 max(1.15rem, env(safe-area-inset-left)) 5rem;
  display: grid; grid-template-columns: minmax(0, 1fr); gap: 0 var(--gap);
}
main { grid-column: 1; min-width: 0; }

/* ── prose ──────────────────────────────────────────────────────────────── */
h1, h2, h3 { text-wrap: balance; }
h1 {
  font-size: clamp(1.85rem, 1.35rem + 2.2vw, 2.55rem); line-height: 1.15;
  margin: 1.9rem 0 0.5rem; letter-spacing: -0.015em;
}
h2 {
  font-size: clamp(1.3rem, 1.12rem + 0.8vw, 1.6rem); line-height: 1.25;
  margin: 3rem 0 0.5rem; padding-top: 0.85rem;
  border-top: 1px solid var(--border); letter-spacing: -0.01em;
}
h3 { font-size: 1.1rem; margin: 1.9rem 0 0.25rem; color: var(--fg2); }
h2 .anchor, h3 .anchor {
  margin-left: 0.45em; color: var(--fg4); text-decoration: none;
  font-weight: 400; opacity: 0; transition: opacity 0.12s;
}
h2:hover .anchor, h3:hover .anchor, .anchor:focus-visible { opacity: 1; }
/* Without this an anchored heading lands under the sticky bar — which is every
   link in the effects page's own table of contents. */
h1, h2, h3 { scroll-margin-top: 1.5rem; }
p, li { color: var(--fg2); }
p { margin: 0 0 1rem; }
li { margin-bottom: 0.3rem; }
ul, ol { padding-left: 1.35rem; }
/* The paragraph under the h1 is the page's own summary — lead with it. */
main > p:first-of-type { font-size: 1.09rem; color: var(--fg); line-height: 1.6; }
a { color: var(--accent); text-underline-offset: 2px; }
a:hover { text-decoration-thickness: 2px; }
strong { color: var(--fg); }
code {
  font-family: var(--mono); font-size: 0.86em; background: var(--card);
  border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px;
  overflow-wrap: break-word;
}
pre {
  background: var(--card); border: 1px solid var(--border); border-radius: 8px;
  padding: 0.85rem 0.95rem; overflow-x: auto;
}
pre code { background: none; border: 0; padding: 0; }
blockquote {
  margin: 1rem 0; padding: 0.15rem 1rem; border-left: 3px solid var(--border);
  color: var(--fg3);
}
img, video { max-width: 100%; height: auto; border-radius: 8px; }
figure { margin: 1.6rem 0; }
figure img { display: block; border: 1px solid var(--border); }
figcaption { margin-top: 0.4rem; font-size: 0.82rem; color: var(--fg4); }
figcaption a { text-decoration: none; }
figcaption a:hover { text-decoration: underline; }
video { border: 1px solid var(--border); display: block; margin: 1.6rem 0; }

/* Scrolls rather than crushing its columns; the shadow says there is more. */
.tablewrap {
  overflow-x: auto; margin: 1.3rem 0; border-radius: 8px;
  border: 1px solid var(--border);
  background:
    linear-gradient(90deg, var(--bg) 30%, transparent) left / 34px 100% no-repeat,
    linear-gradient(-90deg, var(--bg) 30%, transparent) right / 34px 100% no-repeat,
    radial-gradient(farthest-side at 0 50%, rgba(0, 0, 0, 0.5), transparent) left / 14px 100% no-repeat,
    radial-gradient(farthest-side at 100% 50%, rgba(0, 0, 0, 0.5), transparent) right / 14px 100% no-repeat;
  background-attachment: local, local, scroll, scroll;
}
/* A floor on the width so a phone scrolls the table sideways instead of
   reflowing "Sources and wiring" onto two lines in a 90px column. */
table { border-collapse: collapse; width: 100%; min-width: 26rem; font-size: 0.94rem; }
/* Except the picture grids, which are headerless and shrink happily. */
table:has(th:empty) { min-width: 0; }
th, td {
  border-bottom: 1px solid var(--border); padding: 0.5rem 0.75rem;
  text-align: left; vertical-align: top;
}
tr:last-child td { border-bottom: 0; }
th { background: var(--card); color: var(--fg); font-weight: 600; }
/* The picture grids in the markdown are headerless tables of images. */
th:empty { padding: 0; border: 0; }
td img { border-radius: 5px; }
kbd {
  font-family: var(--mono); font-size: 0.78rem; background: var(--card);
  border: 1px solid var(--fg4); border-bottom-width: 2px; border-radius: 4px;
  padding: 1px 6px; white-space: nowrap;
}
sub, sup { color: var(--fg4); }
hr { border: 0; border-top: 1px solid var(--border); margin: 2.5rem 0; }

/* ── on this page ───────────────────────────────────────────────────────────
   A disclosure on a phone, where it sits above the title collapsed; a sticky
   column in the gutter from 68rem up, where the space was empty anyway. The
   open state is set by script per width — an attribute no media query reaches,
   and closed is the safe default if the script never runs. */
.toc { margin: 1.25rem 0 0; border: 1px solid var(--border); border-radius: 8px; }
.toc > summary {
  cursor: pointer; padding: 0.6rem 0.85rem; color: var(--fg3);
  font-size: 0.83rem; letter-spacing: 0.06em; text-transform: uppercase;
  list-style: none;
}
.toc > summary::-webkit-details-marker { display: none; }
.toc > summary::after { content: ' ▾'; color: var(--fg4); }
.toc[open] > summary::after { content: ' ▴'; }
.toc nav { display: flex; flex-direction: column; padding: 0 0 0.6rem; }
.toc a {
  color: var(--fg3); text-decoration: none; font-size: 0.88rem; line-height: 1.35;
  padding: 0.32rem 0.85rem; border-left: 2px solid transparent;
}
.toc a:hover { color: var(--fg); background: var(--card); }
.toc a.l3 { padding-left: 1.7rem; font-size: 0.83rem; color: var(--fg4); }
.toc a.here { color: var(--accent); border-left-color: var(--accent); }

/* ── pager ──────────────────────────────────────────────────────────────── */
.pager {
  display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;
  margin-top: 3.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border);
}
.pager a {
  display: flex; flex-direction: column; gap: 0.15rem; padding: 0.7rem 0.9rem;
  border: 1px solid var(--border); border-radius: 8px; text-decoration: none;
  background: var(--card);
}
.pager a:hover { border-color: var(--accent); }
.pager a.next { text-align: right; }
.pager span { font-size: 0.78rem; color: var(--fg4); }
.pager b { color: var(--fg); font-size: 0.98rem; }

/* ── footer ─────────────────────────────────────────────────────────────── */
footer { border-top: 1px solid var(--border); background: var(--card); }
.foot {
  max-width: calc(var(--measure) + var(--aside) + var(--gap)); margin: 0 auto;
  padding: 1.75rem max(1.15rem, env(safe-area-inset-left))
    calc(2rem + env(safe-area-inset-bottom));
  display: flex; flex-wrap: wrap; gap: 0.5rem 1.35rem; align-items: baseline;
  font-size: 0.86rem;
}
.foot a { color: var(--fg3); text-decoration: none; }
.foot a:hover { color: var(--fg); }
.foot .sep { flex-basis: 100%; height: 0; }
.foot small { color: var(--fg4); }

@media (min-width: 46rem) {
  body { font-size: 17px; }
  header { position: sticky; top: 0; z-index: 10; }
  @supports (backdrop-filter: blur(8px)) {
    header { background: rgba(14, 14, 17, 0.88); backdrop-filter: blur(8px); }
  }
  .bar {
    flex-wrap: nowrap; padding-bottom: 0; height: var(--bar);
    align-items: stretch;
  }
  .brand, .cta { align-self: center; margin-right: 0; }
  /* margin-right auto is what pushes the call to action to the far edge. */
  .pages {
    width: auto; order: 0; margin: 0 auto 0 1.6rem; padding: 0;
    mask-image: none; overflow: visible;
  }
  .pages a { display: flex; align-items: center; padding: 0; }
  /* Clear the sticky bar when an anchor scrolls a heading into view. */
  h1, h2, h3 { scroll-margin-top: calc(var(--bar) + 1rem); }
}

@media (min-width: 68rem) {
  .wrap { grid-template-columns: minmax(0, var(--measure)) var(--aside); }
  /* A page with no section nav centres its column instead of holding open a
     gutter with nothing in it. Costs a small sideways shift on the way to a
     page that has one; an empty third of the window costs more. */
  .wrap.solo {
    grid-template-columns: minmax(0, var(--measure)); justify-content: center;
  }
  main { padding-top: 0.5rem; }
  .toc {
    grid-column: 2; grid-row: 1; align-self: start; position: sticky;
    top: calc(var(--bar) + 1.5rem); margin-top: 4.4rem; border: 0;
    border-left: 1px solid var(--border); border-radius: 0;
    max-height: calc(100vh - var(--bar) - 3rem); overflow-y: auto;
  }
  .toc { scrollbar-width: thin; }
  /* No disclosure arrow where it is not a disclosure. The [open] rule above is
     the more specific one, so it has to be turned off by name. */
  /* Sticky inside its own scroll, or the label leaves with the list. */
  .toc > summary {
    pointer-events: none; padding-left: 0.85rem; position: sticky; top: 0;
    background: var(--bg);
  }
  .toc > summary::after, .toc[open] > summary::after { content: none; }
}
</style>
</head>
<body id="top">
<a class="skip" href="#content">Skip to content</a>
<header>
  <div class="bar">
    <a class="brand" href="index.html">ntsc.js<span>guide</span></a>
    <nav class="pages" aria-label="Guide pages">
      ${PAGES.map(p => `<a${p.out === current ? ' class="on" aria-current="page"' : ''} href="${p.out}">${p.nav}</a>`).join('\n      ')}
    </nav>
    <a class="cta" href="../">Open the app ↗</a>
  </div>
</header>
<div class="wrap${headings.length < NAV_MIN ? ' solo' : ''}">
${tocFor(headings)}
<main id="content">
${body}
${pagerFor(current)}
</main>
</div>
<footer>
  <div class="foot">
    <a href="../">Live demo ↗</a>
    <a href="https://github.com/cmdcolin/ntsc.js">Source ↗</a>
    <a href="https://github.com/cmdcolin/ntsc.js/issues">Issues ↗</a>
    <a href="#top">Back to top ↑</a>
    <span class="sep"></span>
    <small>MIT. Needs a WebGPU browser — Chrome, Edge, Safari 26+, or Firefox Nightly on Linux.</small>
  </div>
</footer>
<script>
// Two things no media query can express: a <details> that starts open only
// where it is the gutter nav, and highlighting the section being read.
;(function () {
  var toc = document.querySelector('details.toc')
  if (toc && matchMedia('(min-width: 68rem)').matches) toc.open = true

  var pages = document.querySelector('.pages')
  var on = pages && pages.querySelector('a.on')
  // Scroll the current page into view only while the row actually scrolls,
  // i.e. on a phone, where it is otherwise off the right-hand end.
  if (on && pages.scrollWidth > pages.clientWidth) {
    on.scrollIntoView({ inline: 'center', block: 'nearest' })
  }

  // Mark the section being read. "The last heading that has passed the top of
  // the window" rather than "the heading currently on screen": the second one
  // has nothing to say once the last section is shorter than the viewport,
  // which is where every page ends.
  var pairs = []
  ;[].slice.call(document.querySelectorAll('.toc a')).forEach(function (a) {
    var h = document.getElementById(a.hash.slice(1))
    if (h) pairs.push({ a: a, h: h })
  })
  if (pairs.length === 0) return

  var at = -1
  var queued = false
  function spy() {
    queued = false
    var i = 0
    for (var n = 0; n < pairs.length; n++) {
      if (pairs[n].h.getBoundingClientRect().top - 96 <= 0) i = n
      else break
    }
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) {
      i = pairs.length - 1
    }
    if (i === at) return
    if (at >= 0) pairs[at].a.classList.remove('here')
    pairs[i].a.classList.add('here')
    at = i
    // Keep the mark visible when the list is longer than its own column.
    if (toc && toc.scrollHeight > toc.clientHeight + 1) {
      toc.scrollTop = pairs[i].a.offsetTop - toc.clientHeight / 2
    }
  }

  addEventListener(
    'scroll',
    function () {
      if (queued) return
      queued = true
      requestAnimationFrame(spy)
    },
    { passive: true },
  )
  spy()
})()
</script>
</body>
</html>
`

mkdirSync(join(outDir, 'img'), { recursive: true })
for (const file of readdirSync('docs/img')) {
  copyFileSync(join('docs/img', file), join(outDir, 'img', file))
}
for (const spec of PAGES) {
  // `env` carries the source directory in and the page's outline back out.
  const env = { dir: dirname(spec.file), headings: [] }
  const body = forceDarkDiagrams(
    withLiveLinks(md.render(readFileSync(spec.file, 'utf8'), env)),
  )
  writeFileSync(
    join(outDir, spec.out),
    page(body, spec.nav, spec.out, env.headings),
  )
  console.log(
    `  ✓ ${join(outDir, spec.out)}` +
      (env.headings.length < 5 ? '' : ` (${env.headings.length} sections)`),
  )
}
