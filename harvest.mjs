/**
 * Fetches this language's publishers and records which of our words each page held.
 *
 * A separate, deliberate step, run rarely and by hand. The build reads the file it writes, so a
 * rebuild needs no network and the evidence stays reproducible — nobody re-fetches thousands of
 * pages to rebuild a list.
 *
 * **It records counts, never text.** The page is fetched, matched against this language's
 * candidates, and thrown away; what is written is `url<TAB>WORD:count WORD:count …`. The first
 * version kept the fetched text, and that was a serious mistake: a public repository of
 * harvested articles republishes somebody's journalism, and escaping a share-alike dictionary by
 * copying newspapers would be no escape at all. A count of words already in our own dictionary
 * is a fact about the page, cannot reconstruct it, and is all the build ever needed.
 *
 * It appends. A harvest is slow by design — one request at a time, a second apart — so stopping
 * one halfway should cost the pages not yet fetched, not the ones already in hand.
 *
 * **A language that needs an analyser needs it here too.** Matching a fetched page with a regular
 * expression assumes two things that are not true everywhere: that words are separated by
 * something, and that the page is written in the script the list is written in. Japanese fails
 * both — a run of kanji has no boundaries in it, and the list is kana — so its harvest found one
 * word across three national newspapers before this. Such a language exports `READ` from
 * `sources.mjs`, the same analyser its collections already go through, and the pages are read
 * with it rather than with a second, worse answer to the same question.
 *
 * Usage:
 *   node harvest.mjs           # every domain in sources.mjs
 *   node harvest.mjs 200       # at most 200 pages per domain
 */
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { alphabetFor } from '@blinkered/engine'
import { domainOf, harvestSites } from '@blinkered/attestation'
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
const perDomain = Number(process.argv[2] ?? 300)

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

process.stderr.write(
  `${LANGUAGE}: ${String(DOMAINS.length)} domains, up to ${String(perDomain)} pages each\n`,
)
if (already.size > 0) process.stderr.write(`${String(already.size)} pages already harvested\n`)

/** Pages we have not seen before. Filtered before the analyser, which is the expensive part. */
async function* fetched() {
  for await (const page of harvestSites(DOMAINS, undefined, perDomain)) {
    if (already.has(page.locator)) continue
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
  appendFileSync(OUT, `${page.locator}\t${record}\n`)
  const domain = domainOf(page.locator)
  counts.set(domain, (counts.get(domain) ?? 0) + 1)
  added += 1
  if (added % 50 === 0) process.stderr.write(`  ${String(added)} pages\n`)
}

process.stderr.write(`\nadded ${String(added)} pages across ${String(counts.size)} domains\n`)
for (const [domain, n] of [...counts].sort((left, right) => right[1] - left[1])) {
  process.stderr.write(`  ${domain.padEnd(28)} ${String(n)}\n`)
}
