/**
 * Removes books that are not in this language.
 *
 * A downloader restarted with the wrong collection put Japanese and English books onto French's
 * shelf. The legibility floor in `scan` already refuses them — a book in another language holds
 * almost none of this one's words, which is the same signal that catches bad OCR — so the
 * evidence was never at risk. But they cost every later build the time to read them, and a shelf
 * that says three hundred French books should hold three hundred French books.
 *
 * The test is the one the build applies, so nothing goes that would have been believed.
 *
 *   node weed.mjs            # report
 *   node weed.mjs --remove
 */
import { appendFileSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { alphabetFor } from '@blinkered/engine'
import * as language from './sources.mjs'

const { LANGUAGE, READ } = language

// A language that reads its collections through an analyser cannot be judged without it: a
// Japanese book is kanji and this list is kana, so every book would look like the wrong
// language. The same mistake the harvest made, and it would delete a whole good shelf.
if (READ !== undefined) {
  throw new Error(
    `${LANGUAGE} reads its collections through an analyser, so this test cannot judge them`,
  )
}

const remove = process.argv.includes('--remove')
const dir = new URL(`.cache/raw/archive-${LANGUAGE}`, import.meta.url).pathname
const fold = alphabetFor(LANGUAGE).fold

const candidates = new Set(
  readFileSync(
    process.env.CANDIDATES ??
      new URL(`../blinkered-attestation/candidates/${LANGUAGE}/words.txt`, import.meta.url).pathname,
    'utf8',
  )
    .split('\n')
    .slice(1)
    .filter((line) => line !== '')
    .map((line) => line.split('\t')[0]),
)

/** The same floor the build applies, so this removes only what a build would already refuse. */
const FLOOR = 0.35
const TOKEN = /\p{L}[\p{L}\p{M}'’]*/gu

let kept = 0
let dropped = 0
let freed = 0
for (const name of readdirSync(dir).filter((one) => one.endsWith('.txt'))) {
  const path = `${dir}/${name}`
  const text = readFileSync(path, 'utf8').slice(0, 400_000)
  let counted = 0
  let known = 0
  for (const match of text.matchAll(TOKEN)) {
    const key = fold(match[0].normalize('NFC'))
    if (key.length < 3) continue
    counted += 1
    if (candidates.has(key)) known += 1
  }
  const share = counted === 0 ? 0 : known / counted
  if (share >= FLOOR) {
    kept += 1
    continue
  }
  dropped += 1
  freed += statSync(path).size
  process.stdout.write(`  ${(share * 100).toFixed(0).padStart(3)}%  ${name}\n`)
  if (remove) {
    rmSync(path, { force: true })
    // Written down, or the downloader fetches it again the moment it notices the file is gone
    // and the next weeding removes it again, forever.
    appendFileSync(`${dir}/rejected.tsv`, `${name.replace(/\.txt$/u, '')}\n`)
  }
}

process.stdout.write(
  `${LANGUAGE}: ${String(kept)} books in the language, ${String(dropped)} not ` +
    `(${(freed / 1024 ** 2).toFixed(0)}MB)${remove ? ', removed' : ''}\n`,
)
