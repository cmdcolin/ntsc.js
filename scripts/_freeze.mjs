import { readFileSync, writeFileSync } from 'node:fs'
const names = process.argv.slice(2)
const manifest = JSON.parse(readFileSync('docs/img/shots.json', 'utf8'))
const frozen = JSON.parse(readFileSync('scripts/docshot-frozen.json', 'utf8'))
for (const n of names) {
  const s = manifest.find(x => x.name === n)
  frozen[n] = Object.fromEntries(new URL(s.live).searchParams)
}
writeFileSync('scripts/docshot-frozen.json', JSON.stringify(frozen, null, 2) + '\n')
console.log('frozen:', Object.keys(frozen).join(' '))
