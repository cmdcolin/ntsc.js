// Pull the label dataset out of Firestore and flatten it into something a
// training script can read.
//
// Usage:
//   node scripts/labels.mjs [outDir=labels]
//
// Why this exists rather than a `firebase` command: firestore.rules deliberately
// grants `get` and not `list`, so no signed-in client can enumerate these
// collections — that is what stops a stranger pulling the whole pool down. Getting
// the data out is therefore an admin job, and this is it.
//
// Two ways to authenticate, tried in order:
//
//   1. GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account JSON. The
//      robust path, and the one to use from CI or another machine. Download a key
//      from the console (Project settings > Service accounts).
//   2. The credential `firebase login` already left on this machine. Zero setup,
//      and it is why this runs today without anyone downloading anything — but it
//      reads firebase-tools' own config, so it is the path that will break first
//      if the CLI changes. The error message says so.
//
// Everything here uses the Firestore REST API and node's own crypto, so there is
// no new dependency to install and nothing to keep in step with the app.

import { createSign } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const outDir = process.argv[2] ?? 'labels'
// Pointing at the emulator makes this runnable against seeded data with no
// credentials and no risk to the real database — which is how the flattening
// below is tested, and how you would dry-run a change to it.
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST
const COLLECTIONS = ['ratings', 'votes', 'candidates']
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/datastore'

// The project id, read from the app rather than repeated here: it is already a
// committed constant (a Firebase web config is public — docs/adr/0005), and a
// second copy is one that drifts.
async function projectId() {
  const src = await readFile('src/ui/cloud.ts', 'utf8')
  const found = /projectId: '([^']+)'/.exec(src)
  if (!found) throw new Error('could not find projectId in src/ui/cloud.ts')
  return found[1]
}

const b64url = buf =>
  Buffer.from(buf)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')

// Service account: sign a JWT with the private key and trade it for an access
// token. The whole of RFC 7523's happy path, which is short enough not to be
// worth a dependency.
async function serviceAccountToken(keyPath) {
  const key = JSON.parse(await readFile(keyPath, 'utf8'))
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      exp: now + 3600,
      iat: now,
    }),
  )
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claim}`)
  const jwt = `${header}.${claim}.${b64url(signer.sign(key.private_key))}`
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!res.ok) throw new Error(`service account token: ${await res.text()}`)
  return (await res.json()).access_token
}

// The credential `firebase login` left behind. The client id and secret are read
// out of the installed CLI rather than copied here, so they cannot go stale
// separately — they are public OAuth identifiers for an installed app, not
// secrets, which is why they ship inside every copy of firebase-tools.
async function cliToken() {
  const store = join(homedir(), '.config/configstore/firebase-tools.json')
  const config = JSON.parse(await readFile(store, 'utf8'))
  const tokens = config.tokens ?? {}
  // Reuse the live access token when there is one, with a minute of slack.
  if (tokens.access_token && tokens.expires_at > Date.now() + 60_000) {
    return tokens.access_token
  }
  if (!tokens.refresh_token) {
    throw new Error('no refresh token in the firebase-tools config')
  }
  const api = await readFile('node_modules/firebase-tools/lib/api.js', 'utf8')
  const id = /"FIREBASE_CLIENT_ID", "([^"]+)"/.exec(api)
  const secret = /"FIREBASE_CLIENT_SECRET", "([^"]+)"/.exec(api)
  if (!id || !secret) {
    throw new Error('could not read the CLI oauth constants')
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: id[1],
      client_secret: secret[1],
    }),
  })
  if (!res.ok) throw new Error(`refresh: ${await res.text()}`)
  return (await res.json()).access_token
}

async function accessToken() {
  // The emulator authorizes anything; `owner` is the conventional stand-in.
  if (EMULATOR) return 'owner'
  const key = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (key) return serviceAccountToken(key)
  try {
    return await cliToken()
  } catch (e) {
    throw new Error(
      `could not authenticate. Run \`firebase login\`, or set GOOGLE_APPLICATION_CREDENTIALS to a service-account key — the robust path, and the one to use if this keeps failing (${e.message}).`,
    )
  }
}

// Firestore's REST encoding is a tagged union per field. Unwrapped here rather
// than left in the JSONL, because every consumer would otherwise have to do it.
function plain(value) {
  if ('nullValue' in value) return null
  if ('booleanValue' in value) return value.booleanValue
  if ('stringValue' in value) return value.stringValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return value.doubleValue
  if ('timestampValue' in value) return value.timestampValue
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(plain)
  if ('mapValue' in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields ?? {}).map(([k, v]) => [
        k,
        plain(v),
      ]),
    )
  }
  // A type this build has not seen. Kept as-is rather than dropped: an export
  // that silently loses a column is worse than one with an odd value in it.
  return value
}

async function fetchCollection(pid, name, token) {
  const rows = []
  let pageToken
  do {
    const base = EMULATOR
      ? `http://${EMULATOR}/v1`
      : 'https://firestore.googleapis.com/v1'
    const url = new URL(
      `${base}/projects/${pid}/databases/(default)/documents/${name}`,
    )
    url.searchParams.set('pageSize', '300')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`)
    const body = await res.json()
    for (const doc of body.documents ?? []) {
      rows.push({
        id: doc.name.split('/').pop(),
        ...Object.fromEntries(
          Object.entries(doc.fields ?? {}).map(([k, v]) => [k, plain(v)]),
        ),
      })
    }
    pageToken = body.nextPageToken
  } while (pageToken)
  return rows
}

const csvCell = v => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}
const csv = (header, rows) =>
  [header.join(','), ...rows.map(r => r.map(csvCell).join(','))].join('\n') +
  '\n'

// The training table. One row per rating, tags as one-hot columns — which is the
// shape ten independent per-tag regressions want, and the whole reason to flatten
// at all.
function ratingsTable(ratings) {
  const tags = [...new Set(ratings.flatMap(r => r.tags ?? []))].sort()
  const header = [
    'id',
    'look',
    'cool',
    'provenance',
    'preset',
    'source',
    'ms',
    'at',
    'by',
    'tagSet',
    ...tags.map(t => `tag_${t}`),
    'weights_json',
    'query',
  ]
  const rows = ratings.map(r => [
    r.id,
    r.look,
    r.cool,
    r.provenance,
    r.preset ?? '',
    r.source,
    r.ms,
    r.at,
    r.by,
    r.tagSet,
    ...tags.map(t => ((r.tags ?? []).includes(t) ? 1 : 0)),
    JSON.stringify(r.weights ?? {}),
    r.query,
  ])
  return csv(header, rows)
}

// The same ratings in long form: one row per (rating, preset, weight). This is the
// design matrix for attributing a tag to the presets behind it — regressing the
// tag one-hots on these weights is what separates "worn tape is dreamy" from "the
// look it happened to appear in was dreamy".
function weightsTable(ratings) {
  const rows = ratings.flatMap(r =>
    Object.entries(r.weights ?? {}).map(([preset, w]) => [r.id, preset, w]),
  )
  return csv(['rating_id', 'preset', 'weight'], rows)
}

const pid = await projectId()
const token = await accessToken()
await mkdir(outDir, { recursive: true })

const all = {}
for (const name of COLLECTIONS) {
  const rows = await fetchCollection(pid, name, token)
  all[name] = rows
  await writeFile(
    join(outDir, `${name}.jsonl`),
    rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''),
  )
  console.log(`${name}: ${rows.length}`)
}

await writeFile(join(outDir, 'ratings.csv'), ratingsTable(all.ratings))
await writeFile(join(outDir, 'ratings_weights.csv'), weightsTable(all.ratings))

// The one number worth printing without being asked: `surprise`-provenance rows
// are the unbiased slice, and how many there are decides whether anything can be
// fitted yet.
const rolled = all.ratings.filter(r => r.provenance === 'surprise').length
const presets = new Set(all.ratings.flatMap(r => Object.keys(r.weights ?? {})))
console.log(
  `\n${all.ratings.length} ratings (${rolled} from surprise rolls), covering ${presets.size} presets`,
)
console.log(`written to ${outDir}/`)
