import type { ChildProcess } from 'node:child_process'
import type { SearchProvider } from '../../src/types'
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { codeChunker } from '../../src/chunkers/code'
import { sqliteFts } from '../../src/db/sqlite-fts'
import { createRetriv } from '../../src/retriv'

// ---------------------------------------------------------------------------
// Corpus — same as vite-search.test.ts
// ---------------------------------------------------------------------------
const VITE_DIST = join(import.meta.dirname, '../../node_modules/vite/dist')
const LIMIT = 10

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

const viteDocs = collectFiles(VITE_DIST)

// ---------------------------------------------------------------------------
// Queries with expected keywords
// ---------------------------------------------------------------------------
interface BenchQuery {
  query: string
  keywords: string[]
  category: 'concept' | 'ranking' | 'cross-file'
  expectFile?: string
}

const queries: BenchQuery[] = [
  // Concept-level — words may not appear literally
  { query: 'hot module replacement', keywords: ['hmr', 'hot'], category: 'concept' },
  { query: 'dependency optimization pre-bundling', keywords: ['optimiz', 'pre-bundle', 'esbuild'], category: 'concept' },
  { query: 'source map generation', keywords: ['sourcemap', 'source-map', 'magicstring'], category: 'concept' },
  { query: 'CSS processing transform postcss', keywords: ['css', 'postcss', 'stylesheet'], category: 'concept' },
  { query: 'proxy middleware server configuration', keywords: ['proxy', 'middleware', 'server'], category: 'concept' },
  { query: 'WebSocket connection', keywords: ['websocket', 'socket', 'ws'], category: 'concept' },
  { query: 'module resolution resolve algorithm', keywords: ['resolve', 'resolv'], category: 'concept' },
  { query: 'rollup plugin hooks transform load', keywords: ['plugin', 'hook', 'transform', 'load'], category: 'concept' },
  { query: 'file watcher chokidar', keywords: ['watch', 'chokidar', 'fswatcher'], category: 'concept' },
  { query: 'environment variables env define', keywords: ['env', 'import.meta.env', 'define'], category: 'concept' },

  // Ranking — expect specific file in top 3
  { query: 'resolveConfig', keywords: ['config'], category: 'ranking', expectFile: 'config' },
  { query: 'optimizedDepsPlugin', keywords: ['config'], category: 'ranking', expectFile: 'config' },
  { query: 'ModuleRunner evaluate', keywords: ['module-runner', 'client'], category: 'ranking', expectFile: 'module-runner' },

  // Cross-file — expect specific file in results
  { query: 'command line interface argv build serve preview', keywords: ['cli'], category: 'cross-file', expectFile: 'cli' },
  { query: 'HMR accept dispose prune', keywords: ['client'], category: 'cross-file', expectFile: 'client' },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
interface NormalizedResult {
  id: string
  content: string
  score: number
}

function scoreKeywordHits(results: NormalizedResult[], keywords: string[]): number {
  return results.filter(r =>
    keywords.some(kw => r.content.toLowerCase().includes(kw.toLowerCase())),
  ).length
}

function hasFileInTop(results: NormalizedResult[], expectFile: string, topN = 3): boolean {
  return results.slice(0, topN).some(r => r.id.toLowerCase().includes(expectFile))
}

// ---------------------------------------------------------------------------
// osgrep HTTP helpers
// ---------------------------------------------------------------------------
const OSGREP_PORT = 14444 + Math.floor(Math.random() * 1000)

async function osgrepSearch(query: string, limit: number): Promise<NormalizedResult[]> {
  const res = await fetch(`http://localhost:${OSGREP_PORT}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit }),
  })
  if (!res.ok)
    throw new Error(`osgrep search failed: ${res.status}`)
  const data = await res.json() as { results: Array<{ path?: string, file?: string, content?: string, snippet?: string, text?: string, score?: number }> }
  return (data.results || []).map(r => ({
    id: relative(VITE_DIST, r.path || r.file || ''),
    content: r.text || r.content || r.snippet || '',
    score: r.score ?? 0,
  }))
}

async function waitForOsgrep(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${OSGREP_PORT}/health`)
      if (res.ok)
        return true
    }
    catch {}
    await new Promise(r => setTimeout(r, 2000))
  }
  return false
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------
describe('retriv vs osgrep', () => {
  let retriv: SearchProvider
  let osgrepProc: ChildProcess | null = null
  let osgrepAvailable = false

  beforeAll(async () => {
    // 1. Index retriv
    retriv = await createRetriv({
      driver: sqliteFts({ path: ':memory:' }),
      chunking: codeChunker(),
    })
    await retriv.index(viteDocs)

    // 2. Spawn osgrep serve
    try {
      osgrepProc = spawn('pnpm', ['dlx', 'osgrep', 'serve', '--port', String(OSGREP_PORT)], {
        cwd: VITE_DIST,
        stdio: 'pipe',
      })
      osgrepProc.on('error', () => { osgrepAvailable = false })

      // 3. Wait for health + warm-up
      osgrepAvailable = await waitForOsgrep(180_000)
      if (osgrepAvailable) {
        // Warm-up query triggers indexing
        await osgrepSearch('test', 1).catch(() => {})
      }
    }
    catch {
      console.log('osgrep not available, will show retriv-only results')
    }
  }, 300_000)

  afterAll(async () => {
    await retriv?.close?.()
    if (osgrepProc && !osgrepProc.killed)
      osgrepProc.kill()
  })

  it('concept query relevance', async () => {
    const conceptQueries = queries.filter(q => q.category === 'concept')
    const scores: { query: string, retriv: number, osgrep: number | null }[] = []

    for (const { query, keywords } of conceptQueries) {
      const retrivResults = await retriv.search(query, { limit: LIMIT, returnContent: true })
      const retrivNorm: NormalizedResult[] = retrivResults.map(r => ({
        id: r.id,
        content: r.content || '',
        score: r.score,
      }))

      let osgrepScore: number | null = null
      if (osgrepAvailable) {
        const osgrepResults = await osgrepSearch(query, LIMIT).catch(() => [] as NormalizedResult[])
        osgrepScore = scoreKeywordHits(osgrepResults, keywords)
      }

      scores.push({
        query,
        retriv: scoreKeywordHits(retrivNorm, keywords),
        osgrep: osgrepScore,
      })
    }

    // Print
    console.log('\n=== Concept Query Relevance (keyword hits in top-%d) ===\n', LIMIT)
    for (const s of scores) {
      const osPart = s.osgrep !== null ? `osgrep: ${s.osgrep}/${LIMIT}` : 'osgrep: N/A'
      console.log(`  "${s.query}"\n    retriv: ${s.retriv}/${LIMIT}  ${osPart}`)
    }

    const retrivTotal = scores.reduce((a, s) => a + s.retriv, 0)
    const maxTotal = conceptQueries.length * LIMIT
    console.log(`\n  retriv total: ${retrivTotal}/${maxTotal}`)
    if (osgrepAvailable) {
      const osgrepTotal = scores.reduce((a, s) => a + (s.osgrep ?? 0), 0)
      console.log(`  osgrep total: ${osgrepTotal}/${maxTotal}`)
    }

    expect(retrivTotal).toBeGreaterThan(0)
  }, 120_000)

  it('ranking & cross-file accuracy', async () => {
    const fileQueries = queries.filter(q => q.expectFile)
    const scores: { query: string, retriv: boolean, osgrep: boolean | null }[] = []

    for (const { query, expectFile } of fileQueries) {
      const retrivResults = await retriv.search(query, { limit: 5, returnContent: true })
      const retrivNorm: NormalizedResult[] = retrivResults.map(r => ({
        id: r.id,
        content: r.content || '',
        score: r.score,
      }))

      let osgrepHit: boolean | null = null
      if (osgrepAvailable) {
        const osgrepResults = await osgrepSearch(query, 5).catch(() => [] as NormalizedResult[])
        osgrepHit = hasFileInTop(osgrepResults, expectFile!, 3)
      }

      scores.push({
        query,
        retriv: hasFileInTop(retrivNorm, expectFile!, 3),
        osgrep: osgrepHit,
      })
    }

    // Print
    console.log('\n=== Ranking Accuracy (expected file in top-3) ===\n')
    for (const s of scores) {
      const rv = s.retriv ? '✓' : '✗'
      const os = s.osgrep === null ? 'N/A' : s.osgrep ? '✓' : '✗'
      console.log(`  "${s.query}"\n    retriv: ${rv}  osgrep: ${os}`)
    }

    const retrivHits = scores.filter(s => s.retriv).length
    console.log(`\n  retriv: ${retrivHits}/${fileQueries.length}`)
    if (osgrepAvailable) {
      const osgrepHits = scores.filter(s => s.osgrep).length
      console.log(`  osgrep: ${osgrepHits}/${fileQueries.length}`)
    }

    expect(retrivHits).toBeGreaterThan(0)
  }, 60_000)
})
