/**
 * Goes and checks. Takes words from this language's evidence, opens the pages it cites, and
 * reports whether they really hold the word.
 *
 * This is the answer to "prove it". Everything else here produces the claim; this is the only
 * thing that tests it against the world, and it is deliberately the same act a sceptic would
 * perform — expand the locator, fetch the page, look for the word.
 *
 *   node verify.mjs SCHADE        # one word
 *   node verify.mjs --sample 20   # twenty shipped words, chosen at random
 *
 * Pages move, get paywalled and get rewritten, so an unreachable page is reported separately
 * from a page that loaded and did not hold the word. The first is noise; the second is a
 * finding.
 */
import { readFileSync } from 'node:fs'
import { alphabetFor } from '@blinkered/engine'
import { MINIMUM_SOURCES, httpGet, prove, readEvidence } from '@blinkered/attestation'
import { LANGUAGE } from './sources.mjs'

const evidence = readEvidence('.')
const shipped = new Set(
  readFileSync('words.txt', 'utf8')
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map((line) => line.split('\t')[0]),
)
const fold = alphabetFor(LANGUAGE).fold

const [first, second] = process.argv.slice(2)
let chosen
if (first === '--sample') {
  const wanted = Number(second ?? 10)
  const pool = evidence.words.filter((word) => shipped.has(word.word))
  chosen = [...pool].sort(() => Math.random() - 0.5).slice(0, wanted)
} else if (first !== undefined) {
  chosen = evidence.words.filter((word) => word.word === first)
  if (chosen.length === 0) throw new Error(`${first} is not in this language's evidence`)
} else {
  throw new Error('give a word, or --sample N')
}

const tally = { found: 0, archived: 0, absent: 0, unreachable: 0, unresolvable: 0 }
let held = 0

for (const word of chosen) {
  const proof = await prove(word, fold, httpGet, MINIMUM_SOURCES)
  if (proof.holds) held += 1
  process.stdout.write(`${proof.holds ? 'HOLDS  ' : 'FAILED '} ${proof.word}\n`)
  for (const check of proof.checked) {
    tally[check.outcome] += 1
    const mark = {
      found: '  ok  ',
      // The archive held it. For a dated locator — a news crawl — this is the expected pass, not
      // a rescue: the page as it was is the document being cited.
      archived: ' arch ',
      absent: ' MISS ',
      unreachable: ' ???  ',
      unresolvable: ' ??ID ',
    }[check.outcome]
    process.stdout.write(`   ${mark} ${check.source.padEnd(22)} ${check.url}\n`)
  }
}

process.stdout.write(
  `\n${String(held)}/${String(chosen.length)} words proved. ` +
    `pages: ${String(tally.found)} found, ${String(tally.archived)} in the archive, ` +
    `${String(tally.absent)} absent, ${String(tally.unreachable)} unreachable, ` +
    `${String(tally.unresolvable)} unresolvable\n`,
)
if (tally.absent > 0) {
  process.stdout.write(
    'A page that loaded without the word is a finding, not noise. Check the fold before the data.\n',
  )
}
