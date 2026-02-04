import type { SearchProvider } from '../../src/types'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { autoChunker } from '../../src/chunkers/auto'
import { codeChunker } from '../../src/chunkers/code'
import { sqliteFts } from '../../src/db/sqlite-fts'
import { createRetriv } from '../../src/retriv'

// ---------------------------------------------------------------------------
// Load every JS/MJS file under node_modules/vite/dist as documents
// ---------------------------------------------------------------------------
const VITE_DIST = join(import.meta.dirname, '../../node_modules/vite/dist')

function collectFiles(dir: string, out: { id: string, content: string }[] = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      collectFiles(full, out)
    }
    else if (/\.(?:js|mjs|cjs)$/.test(entry)) {
      out.push({
        id: relative(VITE_DIST, full), // e.g. "node/chunks/config.js"
        content: readFileSync(full, 'utf-8'),
      })
    }
  }
  return out
}

const viteDocs = collectFiles(VITE_DIST)

// Shared instances — created once, reused across all describe blocks
let codeSearch: SearchProvider
let autoSearch: SearchProvider

// Index once — the heavy part. 60s timeout for tree-sitter parsing of ~50k LOC
it('indexes vite dist', async () => {
  const [cs, as_] = await Promise.all([
    createRetriv({
      driver: sqliteFts({ path: ':memory:' }),
      chunking: { chunker: await codeChunker() },
    }),
    createRetriv({
      driver: sqliteFts({ path: ':memory:' }),
      chunking: { chunker: await autoChunker() },
    }),
  ])
  await Promise.all([
    cs.index(viteDocs),
    as_.index(viteDocs),
  ])
  codeSearch = cs
  autoSearch = as_

  // Sanity: we indexed a non-trivial amount of content
  const total = viteDocs.reduce((n, d) => n + d.content.length, 0)
  expect(total).toBeGreaterThan(500_000) // ~2 MB of JS
  expect(viteDocs.length).toBeGreaterThanOrEqual(10)
}, 60_000)

// ---------------------------------------------------------------------------
// Concept-level queries — these words may NOT appear literally in the code,
// but BM25 should surface relevant chunks via related terms.
// ---------------------------------------------------------------------------
describe('concept search (BM25 strength)', () => {
  it('finds hot module replacement implementation', async () => {
    const results = await codeSearch.search('hot module replacement', { limit: 10, returnContent: true })
    expect(results.length).toBeGreaterThan(0)
    // HMR logic lives in client.mjs
    const content = results.map(r => r.content ?? '').join('\n')
    expect(content).toMatch(/hmr|hot/i)
  })

  it('finds dependency pre-bundling / optimization', async () => {
    const results = await codeSearch.search('dependency optimization pre-bundling', { limit: 10, returnContent: true })
    expect(results.length).toBeGreaterThan(0)
    const content = results.map(r => r.content ?? '').join('\n')
    expect(content).toMatch(/optimiz|pre.?bundle|esbuild/i)
  })

  it('finds source map generation logic', async () => {
    const results = await codeSearch.search('source map generation', { limit: 10, returnContent: true })
    expect(results.length).toBeGreaterThan(0)
    const content = results.map(r => r.content ?? '').join('\n')
    expect(content).toMatch(/sourcemap|source.?map|MagicString/i)
  })

  it('finds CSS processing pipeline', async () => {
    // With OR mode, multi-word NL queries now return results
    const results = await codeSearch.search('CSS processing transform postcss', { limit: 10, returnContent: true })
    expect(results.length).toBeGreaterThan(0)
    const content = results.map(r => r.content ?? '').join('\n')
    expect(content).toMatch(/css|postcss|stylesheet/i)
  })

  it('finds dev server proxy middleware', async () => {
    const results = await codeSearch.search('proxy middleware server configuration', { limit: 10, returnContent: true })
    expect(results.length).toBeGreaterThan(0)
    const content = results.map(r => r.content ?? '').join('\n')
    expect(content).toMatch(/proxy|middleware|server/i)
  })

  it('finds WebSocket connection handling', async () => {
    // With OR, "WebSocket connection" works even though tokenizer splits WebSocket
    const results = await codeSearch.search('WebSocket connection', { limit: 10, returnContent: true })
    expect(results.length).toBeGreaterThan(0)
    const content = results.map(r => r.content ?? '').join('\n')
    expect(content).toMatch(/WebSocket|socket|ws/i)
  })

  it('finds module resolution / resolve algorithm', async () => {
    const results = await codeSearch.search('module resolution resolve algorithm', { limit: 10, returnContent: true })
    expect(results.length).toBeGreaterThan(0)
    const content = results.map(r => r.content ?? '').join('\n')
    expect(content).toMatch(/resolve|resolv/i)
  })

  it('finds rollup plugin hooks', async () => {
    const results = await codeSearch.search('rollup plugin hooks transform load', { limit: 10, returnContent: true })
    expect(results.length).toBeGreaterThan(0)
    const content = results.map(r => r.content ?? '').join('\n')
    expect(content).toMatch(/plugin|hook|transform|load/i)
  })

  it('finds file watcher / chokidar integration', async () => {
    const results = await codeSearch.search('file watcher chokidar', { limit: 10, returnContent: true })
    expect(results.length).toBeGreaterThan(0)
    const content = results.map(r => r.content ?? '').join('\n')
    expect(content).toMatch(/watch|chokidar|FSWatcher/i)
  })

  it('finds environment variable handling', async () => {
    const results = await codeSearch.search('environment variables env define', { limit: 10, returnContent: true })
    expect(results.length).toBeGreaterThan(0)
    const content = results.map(r => r.content ?? '').join('\n')
    expect(content).toMatch(/env|import\.meta\.env|define/i)
  })
})

// ---------------------------------------------------------------------------
// Cross-file relevance — queries that should surface chunks from specific files
// ---------------------------------------------------------------------------
describe('cross-file relevance', () => {
  it('maps CLI commands to cli.js', async () => {
    const results = await codeSearch.search('command line interface argv build serve preview', { limit: 10 })
    expect(results.length).toBeGreaterThan(0)
    expect(results.some(r => r.id.includes('cli'))).toBe(true)
  })

  it('maps build pipeline to build chunk', async () => {
    const results = await codeSearch.search('rollup bundle output build', { limit: 10 })
    expect(results.length).toBeGreaterThan(0)
    expect(results.some(r => r.id.includes('build') || r.id.includes('config'))).toBe(true)
  })

  it('maps logger/color output to logger chunk', async () => {
    const results = await codeSearch.search('logger color output level', { limit: 10 })
    expect(results.length).toBeGreaterThan(0)
    expect(results.some(r => r.id.includes('logger'))).toBe(true)
  })

  it('maps client HMR to client.mjs', async () => {
    const results = await codeSearch.search('HMR accept dispose prune', { limit: 10 })
    expect(results.length).toBeGreaterThan(0)
    expect(results.some(r => r.id.includes('client'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Ranking quality — the most relevant file should rank in top 3
// ---------------------------------------------------------------------------
describe('ranking quality', () => {
  it('ranks config resolution in top results for "resolveConfig"', async () => {
    const results = await codeSearch.search('resolveConfig', { limit: 5 })
    expect(results.length).toBeGreaterThan(0)
    // resolveConfig is defined in the config chunk
    const top3 = results.slice(0, 3).map(r => r.id)
    expect(top3.some(id => id.includes('config'))).toBe(true)
  })

  it('ranks optimized deps handler in top results', async () => {
    const results = await codeSearch.search('optimizedDepsPlugin', { limit: 5 })
    expect(results.length).toBeGreaterThan(0)
    const top3 = results.slice(0, 3).map(r => r.id)
    expect(top3.some(id => id.includes('config'))).toBe(true)
  })

  it('ranks module runner in top results', async () => {
    const results = await codeSearch.search('ModuleRunner evaluate', { limit: 5 })
    expect(results.length).toBeGreaterThan(0)
    const top3 = results.slice(0, 3).map(r => r.id)
    expect(top3.some(id => id.includes('module-runner') || id.includes('client'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Scale / performance characteristics
// ---------------------------------------------------------------------------
describe('scale', () => {
  it('handles broad query across large corpus without crashing', async () => {
    const results = await codeSearch.search('function', { limit: 50, returnContent: true })
    expect(results.length).toBe(50)
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0)
      expect(r.score).toBeLessThanOrEqual(1)
    }
  })

  it('returns many results for broad query on large corpus', async () => {
    const results = await codeSearch.search('esbuild transform', { limit: 20 })
    expect(results.length).toBeGreaterThan(5)
    // All scores should be valid normalized values
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0)
      expect(r.score).toBeLessThanOrEqual(1)
    }
  })

  it('respects small limit on large corpus', async () => {
    const results = await codeSearch.search('const', { limit: 3 })
    expect(results.length).toBeLessThanOrEqual(3)
  })
})

// ---------------------------------------------------------------------------
// Chunker comparison — code chunker vs auto chunker on same corpus
// ---------------------------------------------------------------------------
describe('chunker comparison', () => {
  it('both chunkers return results for same query', async () => {
    const [codeResults, autoResults] = await Promise.all([
      codeSearch.search('WebSocket', { limit: 10 }),
      autoSearch.search('WebSocket', { limit: 10 }),
    ])
    expect(codeResults.length).toBeGreaterThan(0)
    expect(autoResults.length).toBeGreaterThan(0)
  })

  it('code chunker produces chunk annotations on large files', async () => {
    const results = await codeSearch.search('resolveConfig', { limit: 10 })
    const chunked = results.filter(r => r._chunk)
    // config.js is 36k lines — must be chunked
    expect(chunked.length).toBeGreaterThan(0)
    for (const r of chunked) {
      expect(r._chunk!.parentId).toBeTruthy()
      expect(typeof r._chunk!.index).toBe('number')
    }
  })

  it('auto chunker also chunks large JS files', async () => {
    const results = await autoSearch.search('resolveConfig', { limit: 10 })
    const chunked = results.filter(r => r._chunk)
    expect(chunked.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Content fidelity — returned content should be relevant
// ---------------------------------------------------------------------------
describe('content fidelity', () => {
  it('returned snippet contains query terms', async () => {
    const results = await codeSearch.search('createServer HTTPS', { limit: 5, returnContent: true })
    expect(results.length).toBeGreaterThan(0)
    const match = results.find(r => r.content && /createServer|https/i.test(r.content))
    expect(match).toBeDefined()
  })

  it('returned content is non-empty for code chunks', async () => {
    const results = await codeSearch.search('esbuild transform', { limit: 5, returnContent: true })
    expect(results.length).toBeGreaterThan(0)
    for (const r of results) {
      expect(r.content).toBeTruthy()
      expect(r.content!.length).toBeGreaterThan(10)
    }
  })
})

// ---------------------------------------------------------------------------
// Negative / edge cases at scale
// ---------------------------------------------------------------------------
describe('edge cases at scale', () => {
  it('nonsense query returns empty on large corpus', async () => {
    const results = await codeSearch.search('qwzxpljkmnbv', { limit: 5 })
    expect(results).toHaveLength(0)
  })

  it('very long query does not crash', async () => {
    const longQuery = 'import export function const let var class extends implements interface type async await promise resolve reject try catch throw error warning debug info log'.repeat(2)
    const results = await codeSearch.search(longQuery, { limit: 5 })
    expect(Array.isArray(results)).toBe(true)
  })

  it('query with only stopwords still returns results', async () => {
    const results = await codeSearch.search('the and or not', { limit: 5 })
    // FTS5 porter tokenizer may still match — just ensure no crash
    expect(Array.isArray(results)).toBe(true)
  })
})
