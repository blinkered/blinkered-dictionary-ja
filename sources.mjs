/**
 * The collections that attest Japanese, every one of them read aloud first.
 *
 * Japanese is the one language here whose corpora cannot be scanned directly. Blinkered deals it
 * as kana tiles and Japanese is written in kanji, so 食べる folds to 食へる — not a word, matching
 * nothing. Sudachi reads each document into katakana, which the game's own fold turns into the
 * hiragana its list is written in, and only then does a corpus attest anything.
 *
 * **SudachiDict-small, deliberately.** Core and full add NEologd's entries, which descend from
 * Hatena's keyword list, whose terms grant hobby, academic and private use and refer commercial
 * use to Hatena case by case. Not share-alike, but just as blocking for a shipped app, and
 * invisible behind the stated Apache-2.0. Small is UniDic alone under a plain BSD-3 grant.
 *
 * **The wiki collections are capped.** Sudachi reading a 2.2GB Wikipedia is hours of work for a
 * curve that flattens long before the end. The cap is stated here rather than hidden so a reader
 * knows the list was cut and by how much.
 */

import { createReadStream, existsSync, readFileSync, readdirSync } from 'node:fs'
import { createInterface } from 'node:readline'
import {
  fileDocuments,
  gutenbergBody,
  harvestDocuments,
  take,
  tatoebaDocuments,
  wikiDocuments,
  withReadings,
} from '@blinkered/attestation'

export const LANGUAGE = 'ja'

const CACHE = new URL('.cache/raw/', import.meta.url).pathname
const PYTHON = `${CACHE}../sudachi-venv/bin/python`
// Relative to this repository, not through the cache. It used to be reached as
// `.cache/raw/../../resources`, which worked only while `.cache` was a real directory inside
// blinkered-attestation: moving the cache out made `.cache` a symlink too, and the `..` steps
// then climbed one level too far.
const READER = new URL('../blinkered-attestation/resources/readings.py', import.meta.url).pathname

/**
 * Every Japanese collection goes through this; nothing here attests without it.
 *
 * Exported as `READ` as well, because the harvest needs exactly the same treatment. A fetched
 * Japanese page is kanji with no spaces in it, and the list is kana: a regular expression over
 * that text finds one enormous token and matches nothing.
 */
const read = (documents) => withReadings(documents, PYTHON, READER)
export const READ = read

/** Articles scanned per wiki. Sudachi is the cost, not the download. */
const WIKI_ARTICLES = 150_000

export const SOURCES = [
  {
    id: 'wiki:ja',
    what: `Japanese Wikipedia, first ${WIKI_ARTICLES.toLocaleString()} articles, read aloud`,
    needs: `${CACHE}jawiki.xml.bz2`,
    documents: () => read(take(wikiDocuments(`${CACHE}jawiki.xml.bz2`), WIKI_ARTICLES)),
  },
  {
    id: 'wikisource:ja',
    what: 'Japanese Wikisource — same Wikimedia family, so it corroborates rather than counts',
    needs: `${CACHE}jawikisource.xml.bz2`,
    documents: () => read(take(wikiDocuments(`${CACHE}jawikisource.xml.bz2`), WIKI_ARTICLES)),
  },
  {
    id: 'tat',
    from: 'https://downloads.tatoeba.org/exports/per_language/jpn/jpn_sentences.tsv.bz2',
    what: 'Tatoeba Japanese — contemporary and conversational',
    needs: `${CACHE}jpn_sentences.tsv`,
    documents: () => read(tatoebaDocuments(`${CACHE}jpn_sentences.tsv`)),
  },
  {
    id: 'gut',
    from: 'https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv',
    what: 'Project Gutenberg Japanese — a small shelf, but its own family',
    needs: `${CACHE}gutenberg-ja`,
    documents: () => {
      const dir = `${CACHE}gutenberg-ja`
      const books = readdirSync(dir)
        .filter((file) => file.endsWith('.txt'))
        .map((file) => ({ locator: file.replace('.txt', ''), path: `${dir}/${file}` }))
      return read(fileDocuments(books, async (path) => gutenbergBody(readFileSync(path, 'utf8'))))
    },
  },
  {
    id: 'fw2',
    // Where it came from, so a half-finished download is caught before it is read.
    from: 'https://huggingface.co/datasets/HuggingFaceFW/fineweb-2/resolve/main/data/jpn_Jpan/train/000_00000.parquet',
    what: 'FineWeb-2 jpn_Jpan — the crawled web, each document citing its own URL',
    needs: `${CACHE}fineweb2-jpn.parquet`,
    documents: async function* () {
      const { fineweb2Documents } = await import('@blinkered/attestation')
      yield* read(take(fineweb2Documents(`${CACHE}fineweb2-jpn.parquet`), 300_000))
    },
  },
  {
    id: 'ia',
    // Scanned books are OCR, and OCR fails in a way that looks like text. Clean Gutenberg scores
    // a median 52% known words and never below 36%; the worst of these scored 1%, an English
    // book read as Cyrillic. Below this floor a book is not legible enough to attest anything.
    legible: 0.35,
    what: 'Internet Archive japanese books — literature, and the register a newspaper never reaches',
    needs: `${CACHE}archive-ja`,
    from: 'https://archive.org/details/booksbylanguage_japanese',
    // Through Sudachi like everything else here. A scanned Japanese book is kanji and this
    // language's list is kana, so reading one without the analyser finds almost nothing — the
    // same mistake the harvest made before it was caught.
    documents: () => {
      const dir = `${CACHE}archive-ja`
      // A locator names the text, not the item: the catalogue page holds no word of the book.
      // `files.tsv` maps an item to the file we read; a book with no recorded name is skipped
      // rather than cited at a page that cannot support it.
      const named = new Map(
        readFileSync(`${dir}/files.tsv`, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => line.split('\t')),
      )
      const books = readdirSync(dir)
        .filter((file) => file.endsWith('.txt'))
        .map((file) => file.replace('.txt', ''))
        .filter((id) => named.has(id))
        // The filename is percent-encoded: two thirds of them contain spaces, and a locator with
        // a space in it would split into two locators, because the evidence format spends spaces
        // as separators. Encoding is also what the URL needs.
        .map((id) => ({
          locator: `${id}/${encodeURIComponent(named.get(id))}`,
          path: `${dir}/${id}.txt`,
        }))
      return read(fileDocuments(books, async (path) => readFileSync(path, 'utf8')))
    },
  },
].filter((source) => {
  if (existsSync(source.needs)) return true
  process.stderr.write(`  (skipping ${source.id}: ${source.needs} is not in .cache/raw)\n`)
  return false
})

/**
 * Japanese publishers. Each is its own family, and all of them need reading aloud too.
 */
export const DOMAINS = [
  'asahi.com', 'mainichi.jp', 'yomiuri.co.jp', 'nikkei.com', 'sankei.com',
  'tokyo-np.co.jp', 'chunichi.co.jp', 'hokkaido-np.co.jp', 'kobe-np.co.jp',
  'nhk.or.jp', 'news24.jp', 'tv-asahi.co.jp', 'itmedia.co.jp', 'impress.co.jp',
  'gigazine.net', 'natalie.mu', 'oricon.co.jp', 'cinra.net',
]

export const HARVEST = existsSync(new URL('searched.tsv', import.meta.url).pathname)
  ? () => read(harvestDocuments(new URL('searched.tsv', import.meta.url).pathname))
  : undefined

/** Carried over from Blinkered's calibration; must be re-measured before anything ships. */
export const COMMON_CUT = 17_000
