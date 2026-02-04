import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Load pre-generated results (run: pnpx tsx test/e2e/generate-bench-results.ts)
// ---------------------------------------------------------------------------
const RESULTS_FILE = join(import.meta.dirname, 'bench-results.json')

interface Result { id: string, content: string, score: number, relevant: boolean }
interface BenchQuery { query: string, keywords: string[], category: string, expectFile?: string }
interface BenchData {
  queries: BenchQuery[]
  results: Record<string, { retriv: Result[], osgrep: Result[] | null }>
}

function loadResults(): BenchData {
  if (!existsSync(RESULTS_FILE))
    throw new Error(`Missing ${RESULTS_FILE} — run: pnpx tsx test/e2e/generate-bench-results.ts`)
  return JSON.parse(readFileSync(RESULTS_FILE, 'utf-8'))
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------
function countRelevant(results: Result[]): number {
  return results.filter(r => r.relevant).length
}

function hasFileInTop(results: Result[], expectFile: string, topN = 3): boolean {
  return results.slice(0, topN).some(r => r.id.toLowerCase().includes(expectFile))
}

function ndcg(results: Result[]): number {
  const dcg = results.reduce((sum, r, i) =>
    sum + (r.relevant ? 1 : 0) / Math.log2(i + 2), 0)
  const nRelevant = results.filter(r => r.relevant).length
  if (nRelevant === 0)
    return 0
  const idcg = Array.from({ length: nRelevant }, (_, i) =>
    1 / Math.log2(i + 2)).reduce((a, b) => a + b, 0)
  return dcg / idcg
}

function reciprocalRank(results: Result[], expectFile: string): number {
  const idx = results.findIndex(r => r.id.toLowerCase().includes(expectFile))
  return idx === -1 ? 0 : 1 / (idx + 1)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('retriv vs osgrep', () => {
  const data = loadResults()
  const osgrepAvailable = Object.values(data.results).some(r => r.osgrep !== null)

  it('concept query relevance (LLM-judged)', () => {
    const conceptQueries = data.queries.filter(q => q.category === 'concept')
    const scores: { query: string, retriv: number, osgrep: number | null, retrivTotal: number, osgrepTotal: number, retrivNDCG: number, osgrepNDCG: number | null }[] = []

    for (const { query } of conceptQueries) {
      const r = data.results[query]
      scores.push({
        query,
        retriv: countRelevant(r.retriv),
        osgrep: r.osgrep ? countRelevant(r.osgrep) : null,
        retrivTotal: r.retriv.length,
        osgrepTotal: r.osgrep?.length ?? 0,
        retrivNDCG: ndcg(r.retriv),
        osgrepNDCG: r.osgrep ? ndcg(r.osgrep) : null,
      })
    }

    console.log('\n=== Concept Query Relevance (LLM-judged) ===\n')
    for (const s of scores) {
      const rPrec = s.retrivTotal > 0 ? (s.retriv / s.retrivTotal * 100).toFixed(0) : '0'
      const oPrec = s.osgrepTotal > 0 ? ((s.osgrep ?? 0) / s.osgrepTotal * 100).toFixed(0) : 'N/A'
      const osPart = s.osgrep !== null ? `osgrep: ${oPrec}% (${s.osgrep}/${s.osgrepTotal}) nDCG: ${s.osgrepNDCG!.toFixed(3)}` : 'osgrep: N/A'
      console.log(`  "${s.query}"\n    retriv: ${rPrec}% (${s.retriv}/${s.retrivTotal}) nDCG: ${s.retrivNDCG.toFixed(3)}  ${osPart}`)
    }

    const retrivRelevant = scores.reduce((a, s) => a + s.retriv, 0)
    const retrivTotal = scores.reduce((a, s) => a + s.retrivTotal, 0)
    const retrivPrecision = retrivTotal > 0 ? (retrivRelevant / retrivTotal * 100).toFixed(1) : '0'
    const retrivMeanNDCG = scores.reduce((a, s) => a + s.retrivNDCG, 0) / scores.length
    console.log(`\n  retriv: ${retrivPrecision}% precision (${retrivRelevant}/${retrivTotal})  nDCG: ${retrivMeanNDCG.toFixed(3)}`)
    if (osgrepAvailable) {
      const osgrepRelevant = scores.reduce((a, s) => a + (s.osgrep ?? 0), 0)
      const osgrepTotal = scores.reduce((a, s) => a + s.osgrepTotal, 0)
      const osgrepPrecision = osgrepTotal > 0 ? (osgrepRelevant / osgrepTotal * 100).toFixed(1) : '0'
      const osgrepMeanNDCG = scores.reduce((a, s) => a + (s.osgrepNDCG ?? 0), 0) / scores.length
      console.log(`  osgrep: ${osgrepPrecision}% precision (${osgrepRelevant}/${osgrepTotal})  nDCG: ${osgrepMeanNDCG.toFixed(3)}`)
    }

    expect(retrivRelevant).toBeGreaterThan(0)
  })

  it('ranking & cross-file accuracy', () => {
    const fileQueries = data.queries.filter(q => q.expectFile)
    const scores: { query: string, retriv: boolean, osgrep: boolean | null, retrivRR: number, osgrepRR: number | null }[] = []

    for (const { query, expectFile } of fileQueries) {
      const r = data.results[query]
      scores.push({
        query,
        retriv: hasFileInTop(r.retriv, expectFile!, 3),
        osgrep: r.osgrep ? hasFileInTop(r.osgrep, expectFile!, 3) : null,
        retrivRR: reciprocalRank(r.retriv, expectFile!),
        osgrepRR: r.osgrep ? reciprocalRank(r.osgrep, expectFile!) : null,
      })
    }

    console.log('\n=== Ranking Accuracy (expected file in top-3) ===\n')
    for (const s of scores) {
      const rv = s.retriv ? '✓' : '✗'
      const os = s.osgrep === null ? 'N/A' : s.osgrep ? '✓' : '✗'
      console.log(`  "${s.query}"\n    retriv: ${rv} (RR ${s.retrivRR.toFixed(3)})  osgrep: ${os}${s.osgrepRR !== null ? ` (RR ${s.osgrepRR.toFixed(3)})` : ''}`)
    }

    const retrivHits = scores.filter(s => s.retriv).length
    const retrivMRR = scores.reduce((a, s) => a + s.retrivRR, 0) / scores.length
    console.log(`\n  retriv: ${retrivHits}/${fileQueries.length}  MRR: ${retrivMRR.toFixed(3)}`)
    if (osgrepAvailable) {
      const osgrepHits = scores.filter(s => s.osgrep).length
      const osgrepMRR = scores.reduce((a, s) => a + (s.osgrepRR ?? 0), 0) / scores.length
      console.log(`  osgrep: ${osgrepHits}/${fileQueries.length}  MRR: ${osgrepMRR.toFixed(3)}`)
    }

    expect(retrivHits).toBeGreaterThan(0)
  })
})
