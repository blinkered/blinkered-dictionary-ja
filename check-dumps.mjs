/**
 * Checks every cached dump against the size its server reports, before a build trusts it.
 *
 * A truncated `.bz2` decompresses happily until it reaches the end of what arrived and then
 * fails as a CRC error indistinguishable from real corruption — deep inside a decompressor, with
 * nothing naming which file it was. That has cost three builds: a partial download during a
 * full disk, a build started while a download was still running, and a dump I never thought to
 * check because a different one had already passed.
 *
 * A size check is a second of HTTP and catches all three.
 *
 *   node check-dumps.mjs
 */
import { readdirSync, statSync } from 'node:fs'

const CACHE = new URL('.cache/raw/', import.meta.url).pathname

/** Wikimedia names its dumps predictably, which is what makes this checkable at all. */
function dumpUrl(name) {
  const wiki = /^([a-z-]+)(wikisource|wiki)\.xml\.bz2$/u.exec(name)
  if (wiki === null) return null
  const [, lang, kind] = wiki
  return `https://dumps.wikimedia.org/${lang}${kind}/latest/${lang}${kind}-latest-pages-articles.xml.bz2`
}

let bad = 0
for (const name of readdirSync(CACHE).sort()) {
  const url = dumpUrl(name)
  if (url === null) continue

  const have = statSync(`${CACHE}${name}`).size
  let expect = null
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow' })
    const header = response.headers.get('content-length')
    expect = header === null ? null : Number(header)
  } catch {
    // The server not answering says nothing about the file, so it is reported as unknown
    // rather than counted against the dump.
  }

  const verdict =
    expect === null ? 'unknown' : have === expect ? 'ok' : `TRUNCATED (${String(expect)} expected)`
  if (verdict.startsWith('TRUNCATED')) bad += 1
  process.stdout.write(`  ${name.padEnd(26)} ${String(have).padStart(13)}  ${verdict}\n`)
}

if (bad > 0) {
  process.stdout.write(`\n${String(bad)} truncated. Re-download before building against them.\n`)
  process.exitCode = 1
}
