#!/usr/bin/env tsx
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { codeChunker } from '../../src/chunkers/code'
import { sqlite } from '../../src/db/sqlite'
import { transformersJs } from '../../src/embeddings/transformers-js'
import { createRetriv } from '../../src/retriv'

const VITE_DIST = join(import.meta.dirname, '../../node_modules/vite/dist')
const DB_PATH = join(VITE_DIST, '.retriv-bench-timing.db')

function collectFiles(dir: string, out: { id: string, content: string }[] = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory())
      collectFiles(full, out)
    else if (/\.(?:js|mjs|cjs)$/.test(entry))
      out.push({ id: relative(VITE_DIST, full), content: readFileSync(full, 'utf-8') })
  }
  return out
}

async function main() {
  const docs = collectFiles(VITE_DIST)
  const totalKB = docs.reduce((a, d) => a + d.content.length, 0) / 1024
  console.log(`Corpus: ${docs.length} files, ${totalKB.toFixed(0)}KB`)

  // Clean slate
  rmSync(DB_PATH, { force: true })

  // Warm up transformers.js model download (exclude from timing)
  console.log('Warming up embedding model...')
  const embeddings = transformersJs({ model: 'Xenova/bge-small-en-v1.5' })
  const warmupProvider = await sqlite({ path: ':memory:', embeddings })
  await warmupProvider.index([{ id: 'warmup', content: 'warmup' }])
  await warmupProvider.close?.()
  console.log('Model ready\n')

  // Hybrid: FTS5 + vector embeddings
  const retriv = await createRetriv({
    driver: sqlite({ path: DB_PATH, embeddings }),
    chunking: codeChunker(),
  })
  await retriv.index(docs)

  // Verify it's real
  const dbSize = statSync(DB_PATH).size
  const hits = await retriv.search('function', { limit: 3 })
  console.log(`DB: ${(dbSize / 1024).toFixed(0)}KB, test query: ${hits.length} results`)

  await retriv.close?.()
  rmSync(DB_PATH, { force: true })
}

main()
