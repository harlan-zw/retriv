#!/usr/bin/env tsx
/**
 * Generates benchmark results for retriv vs osgrep.
 * Run: pnpx tsx test/e2e/generate-bench-results.ts
 * Output: test/e2e/bench-results.json
 */
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { generateText } from 'ai'
import { createGeminiProvider } from 'ai-sdk-provider-gemini-cli'
import { codeChunker } from '../../src/chunkers/code'
import { sqliteFts } from '../../src/db/sqlite-fts'
import { createRetriv } from '../../src/retriv'

const gemini = createGeminiProvider({ authType: 'oauth-personal' })

const VITE_DIST = join(import.meta.dirname, '../../node_modules/vite/dist')
const OUT_FILE = join(import.meta.dirname, 'bench-results.json')
const LIMIT = 10

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
const queries = [
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
  { query: 'resolveConfig', keywords: ['config'], category: 'ranking', expectFile: 'config' },
  { query: 'optimizedDepsPlugin', keywords: ['config'], category: 'ranking', expectFile: 'config' },
  { query: 'ModuleRunner evaluate', keywords: ['module-runner', 'client'], category: 'ranking', expectFile: 'module-runner' },
  { query: 'command line interface argv build serve preview', keywords: ['cli'], category: 'cross-file', expectFile: 'cli' },
  { query: 'HMR accept dispose prune', keywords: ['client'], category: 'cross-file', expectFile: 'client' },
] as const

// ---------------------------------------------------------------------------
// osgrep CLI parser
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\x1B\[[0-9;]*m/g, '')

// Header: "node/module-runner.js:1123 (score: 1.000) [Definition]"
const HEADER_RE = /^(\S+):(\d+)\s+/

function parseOsgrepOutput(raw: string) {
  const clean = stripAnsi(raw)
  const lines = clean.split('\n')
  const results: Result[] = []
  let i = 0

  while (i < lines.length) {
    const headerMatch = lines[i]?.match(HEADER_RE)
    if (!headerMatch) {
      i++
      continue
    }

    const filePath = headerMatch[1]
    const scoreMatch = lines[i]?.match(/score:\s*([\d.]+)/)
    const score = scoreMatch ? Number.parseFloat(scoreMatch[1]) : 0
    i++

    const snippetLines: string[] = []
    while (i < lines.length && !HEADER_RE.test(lines[i])) {
      if (lines[i].startsWith('osgrep results')) {
        i++
        continue
      }
      snippetLines.push(lines[i])
      i++
    }

    results.push({ id: filePath, content: snippetLines.join('\n'), score, relevant: false })
  }
  return results
}

function osgrepSearch(query: string, limit: number) {
  const output = execSync(
    `osgrep search ${JSON.stringify(query)} -m ${limit} --per-file ${limit} --content --scores --plain`,
    { cwd: VITE_DIST, encoding: 'utf-8', timeout: 60_000, stdio: ['pipe', 'pipe', 'pipe'] },
  )
  return parseOsgrepOutput(output)
}

// Deduplicate results by base file (strip chunk suffix), keep best score per file
function dedupeByFile(results: Result[]) {
  const seen = new Map<string, Result>()
  for (const r of results) {
    const file = r.id.replace(/#chunk-\d+$/, '')
    const existing = seen.get(file)
    if (!existing || r.score > existing.score)
      seen.set(file, { ...r, id: file })
  }
  return [...seen.values()]
}

// ---------------------------------------------------------------------------
// LLM relevance judge
// ---------------------------------------------------------------------------
interface Result { id: string, content: string, score: number, relevant: boolean }

async function judgeRelevance(query: string, results: Result[]): Promise<Result[]> {
  if (!results.length)
    return results

  // Truncate content to keep prompt reasonable
  const items = results.map((r, i) => {
    const snippet = r.content.slice(0, 500)
    return `[${i}] ${r.id}\n${snippet}`
  }).join('\n---\n')

  const { text } = await generateText({
    model: gemini('gemini-2.0-flash', { maxOutputTokens: 256 }),
    prompt: `You are judging code search relevance. Given the search query and code results, output ONLY a JSON array of indices (0-based) that are relevant to the query.

A result is relevant if the code snippet is meaningfully related to the query topic — not just containing a common word by coincidence.

Query: "${query}"

Results:
${items}

Output ONLY a JSON array of relevant indices, e.g. [0, 2, 4]. No explanation.`,
  })

  const relevantIndices = new Set<number>(JSON.parse(text.replace(/```json?\n?|\n?```/g, '').trim()))
  return results.map((r, i) => ({ ...r, relevant: relevantIndices.has(i) }))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const viteDocs = collectFiles(VITE_DIST)
  console.log(`Corpus: ${viteDocs.length} files`)

  // 1. retriv
  console.log('Indexing retriv...')
  const dbPath = join(VITE_DIST, '.retriv-bench.db')
  const needsIndex = !existsSync(dbPath)
  const retriv = await createRetriv({
    driver: sqliteFts({ path: dbPath }),
    chunking: codeChunker(),
  })
  if (needsIndex) {
    await retriv.index(viteDocs)
    console.log('  indexed')
  }
  else {
    console.log('  using cached index')
  }

  // 2. osgrep
  let osgrepAvailable = false
  try {
    execSync('osgrep index', { cwd: VITE_DIST, timeout: 120_000, stdio: 'pipe' })
    osgrepAvailable = true
    console.log('osgrep: available')
  }
  catch {
    console.log('osgrep: not available')
  }

  // 3. Run queries + judge relevance
  const results: Record<string, { retriv: Result[], osgrep: Result[] | null }> = {}

  for (const q of queries) {
    const limit = q.category === 'concept' ? LIMIT : 5
    console.log(`  searching: "${q.query}" (limit ${limit})`)

    const retrivRaw = (await retriv.search(q.query, { limit: limit * 3, returnContent: true }))
      .map(r => ({ id: r.id, content: r.content || '', score: r.score, relevant: false }))

    // Expand chunk content with surrounding context for fairer LLM judging
    const retrivExpanded = retrivRaw.map((r) => {
      const baseFile = r.id.replace(/#chunk-\d+$/, '')
      const doc = viteDocs.find(d => d.id === baseFile)
      if (!doc)
        return r
      const idx = doc.content.indexOf(r.content.slice(0, 80))
      if (idx === -1)
        return r
      const start = Math.max(0, idx - 100)
      const end = Math.min(doc.content.length, idx + r.content.length + 100)
      return { ...r, content: doc.content.slice(start, end) }
    })

    const retrivDeduped = dedupeByFile(retrivExpanded).slice(0, limit)

    let osgrepDeduped: Result[] | null = null
    if (osgrepAvailable) {
      try {
        osgrepDeduped = dedupeByFile(osgrepSearch(q.query, limit * 3)).slice(0, limit)
      }
      catch (e) {
        console.log(`    osgrep error: ${e}`)
      }
    }

    // Judge relevance with LLM
    console.log(`    judging relevance...`)
    const retrivJudged = await judgeRelevance(q.query, retrivDeduped)
    const osgrepJudged = osgrepDeduped ? await judgeRelevance(q.query, osgrepDeduped) : null

    const rHits = retrivJudged.filter(r => r.relevant).length
    const oHits = osgrepJudged?.filter(r => r.relevant).length ?? 'N/A'
    console.log(`    retriv: ${rHits}/${retrivJudged.length} relevant  osgrep: ${oHits}/${osgrepJudged?.length ?? 0} relevant`)

    results[q.query] = { retriv: retrivJudged, osgrep: osgrepJudged }
  }

  await retriv.close?.()

  // 4. Write
  writeFileSync(OUT_FILE, JSON.stringify({ queries, results, generatedAt: new Date().toISOString() }, null, 2))
  console.log(`\nWrote ${OUT_FILE}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
