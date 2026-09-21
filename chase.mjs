/**
 * Fetches named pages and records which of this language's words each one held.
 *
 * `harvest.mjs` walks whole publishers, and is the right tool for the bulk of the work. It is the
 * wrong tool for a named word. The first-run tour is built on たいへいよう and たいせいよう, the
 * Pacific and the Atlantic, and the card flips へ to せ to turn one ocean into the other. Both
 * fell out of the attested list — たいへいよう had one family and needs three, たいせいよう had
 * none — and a harvest broad enough to stumble on them again is ten thousand fetches for two
 * words.
 *
 * So the pages are named on the command line, and everything after that is a harvest unchanged:
 * the same analyser, the same token rule, the same fold, the same candidate set, the same
 * `url<TAB>WORD:count` line appended to the same file. This is not a second way of deciding what
 * a page attests. It is the same way, pointed.
 *
 * **It records counts, never text**, for the reason harvest.mjs gives at length.
 *
 * Choosing which pages to fetch is a search, and a search engine is not a source: it suggests
 * where to look. What attests the word is our own fetch of the page, cited by its own URL, as
 * checkable as any other harvested page and belonging to the same `web:` family.
 *
 *   node chase.mjs https://example.com/a https://example.com/b
 *   node chase.mjs --file urls.txt
 *   node chase.mjs --dry-run https://…      # fetch and report, append nothing
 */
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { alphabetFor } from '@blinkered/engine'
import { domainOf, sitePages } from '@blinkered/attestation'
// A namespace import, because `READ` is optional and a named import of a missing export is a
// hard error in ESM rather than `undefined`. Most languages need no analyser and must not have
// to declare that they do not.
import * as language from './sources.mjs'

const { DOMAINS, LANGUAGE, READ } = language

const OUT = new URL('searched.tsv', import.meta.url).pathname
// A harvest appends for hours while a build may stream the same file. A torn read costs a page
// some of its words silently, which is the worst kind of wrong, so the build refuses to start
// while this marker exists. Removed on the way out, including when interrupted.
const RUNNING = `${OUT}.harvesting`
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const fileAt = args.indexOf('--file')
const urls =
  fileAt === -1
    ? args.filter((one) => one.startsWith('http'))
    : readFileSync(args[fileAt + 1], 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('http'))
if (urls.length === 0) throw new Error('usage: node chase.mjs <url>… | --file <urls.txt>')

const CANDIDATES =
  process.env.CANDIDATES ??
  new URL(`../blinkered-attestation/candidates/${LANGUAGE}/words.txt`, import.meta.url).pathname

const candidates = new Set(
  readFileSync(CANDIDATES, 'utf8')
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map((line) => line.split('\t')[0]),
)
const fold = alphabetFor(LANGUAGE).fold

/** The same token rule the scanner uses, so a harvest counts what a scan would have counted. */
const TOKEN = /\p{L}[\p{L}\p{M}'’]*/gu

// Pages already in hand are not fetched again. The point of appending is that a harvest can be
// interrupted, extended, or re-run with more domains without paying for what it already has.
const already = new Set(
  existsSync(OUT)
    ? readFileSync(OUT, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => line.slice(0, line.indexOf('\t')))
    : [],
)
writeFileSync(RUNNING, `${String(process.pid)}\n`)
const done = () => rmSync(RUNNING, { force: true })
process.on('exit', done)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    done()
    process.exit(130)
  })
}

process.stderr.write(`${LANGUAGE}: ${String(urls.length)} named pages\n`)
if (already.size > 0) process.stderr.write(`${String(already.size)} pages already harvested\n`)

/** Pages we have not seen before. Filtered before the analyser, which is the expensive part. */
async function* fetched() {
  for await (const page of sitePages({ urls }, undefined, undefined, 1000)) {
    already.add(page.locator)
    yield page
  }
}

const counts = new Map()
let added = 0
for await (const page of READ === undefined ? fetched() : READ(fetched())) {
  const found = new Map()
  for (const match of page.text.matchAll(TOKEN)) {
    const key = fold(match[0].normalize('NFC'))
    if (key.length < 3 || !candidates.has(key)) continue
    found.set(key, (found.get(key) ?? 0) + 1)
  }
  // A page holding none of our words is still a page we need not fetch again, so its locator is
  // remembered; but there is nothing to record about it.
  if (found.size === 0) continue

  const record = [...found].map(([word, n]) => `${word}:${String(n)}`).join(' ')
  // A dry run fetches and reads exactly as a real one does and writes the line to stdout instead
  // of the record, so what a page would attest can be read before it attests anything.
  if (dryRun) process.stdout.write(`${page.locator}\t${record}\n`)
  else appendFileSync(OUT, `${page.locator}\t${record}\n`)
  const domain = domainOf(page.locator)
  counts.set(domain, (counts.get(domain) ?? 0) + 1)
  added += 1
  if (added % 50 === 0) process.stderr.write(`  ${String(added)} pages\n`)
}

process.stderr.write(`\nadded ${String(added)} pages across ${String(counts.size)} domains\n`)
for (const [domain, n] of [...counts].sort((left, right) => right[1] - left[1])) {
  process.stderr.write(`  ${domain.padEnd(28)} ${String(n)}\n`)
}
