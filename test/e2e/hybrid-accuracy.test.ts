import { describe, expect, it } from 'vitest'
import { sqliteFts } from '../../src/db/sqlite-fts'
import { sqliteVec } from '../../src/db/sqlite-vec'
import { transformers } from '../../src/embeddings/transformers'
import { createRetriv } from '../../src/retriv'
import { loadNuxtDocs } from './fixtures/nuxt-docs'

// Queries with expected relevant keywords/topics
const testQueries = [
  { query: 'how to fetch data in nuxt', keywords: ['useFetch', 'useAsyncData', 'fetch', 'data'] },
  { query: 'server side rendering', keywords: ['ssr', 'server', 'rendering', 'hydration'] },
  { query: 'environment variables', keywords: ['env', 'runtimeConfig', 'environment', 'NUXT_'] },
  { query: 'middleware authentication', keywords: ['middleware', 'auth', 'route', 'navigation'] },
  { query: 'composables and state management', keywords: ['composable', 'useState', 'state', 'pinia'] },
]

describe('hybrid accuracy comparison', () => {
  it('compares single vs hybrid search relevance', async () => {
    const docs = await loadNuxtDocs()
    const subset = docs.slice(0, 30) // Use subset for speed

    const embeddings = transformers({ model: 'Xenova/all-MiniLM-L6-v2' })

    // Create drivers
    const fts = await sqliteFts({ path: ':memory:' })
    const vec = await sqliteVec({ path: ':memory:', embeddings })
    const hybrid = await createRetriv({
      driver: {
        keyword: sqliteFts({ path: ':memory:' }),
        vector: sqliteVec({ path: ':memory:', embeddings }),
      },
    })

    // Index all
    await Promise.all([
      fts.index(subset),
      vec.index(subset),
      hybrid.index(subset),
    ])

    console.log('\n=== Hybrid Search Accuracy Comparison ===\n')
    console.log(`Documents indexed: ${subset.length}`)
    console.log('')

    const results: { query: string, fts: number, vec: number, hybrid: number }[] = []

    for (const { query, keywords } of testQueries) {
      const [ftsResults, vecResults, hybridResults] = await Promise.all([
        fts.search(query, { limit: 5, returnContent: true }),
        vec.search(query, { limit: 5, returnContent: true }),
        hybrid.search(query, { limit: 5, returnContent: true }),
      ])

      // Score: how many of top 5 results contain relevant keywords
      const scoreResults = (res: typeof ftsResults) => {
        return res.filter(r =>
          keywords.some(kw =>
            r.content?.toLowerCase().includes(kw.toLowerCase()),
          ),
        ).length
      }

      const ftsScore = scoreResults(ftsResults)
      const vecScore = scoreResults(vecResults)
      const hybridScore = scoreResults(hybridResults)

      results.push({ query, fts: ftsScore, vec: vecScore, hybrid: hybridScore })

      console.log(`Query: "${query}"`)
      console.log(`  FTS:    ${ftsScore}/5 relevant (top: ${ftsResults[0]?.id || 'none'})`)
      console.log(`  Vector: ${vecScore}/5 relevant (top: ${vecResults[0]?.id || 'none'})`)
      console.log(`  Hybrid: ${hybridScore}/5 relevant (top: ${hybridResults[0]?.id || 'none'})`)
      console.log('')
    }

    // Summary
    const totals = results.reduce(
      (acc, r) => ({
        fts: acc.fts + r.fts,
        vec: acc.vec + r.vec,
        hybrid: acc.hybrid + r.hybrid,
      }),
      { fts: 0, vec: 0, hybrid: 0 },
    )

    const maxPossible = testQueries.length * 5

    console.log('=== Summary ===')
    console.log(`FTS total:    ${totals.fts}/${maxPossible} (${((totals.fts / maxPossible) * 100).toFixed(1)}%)`)
    console.log(`Vector total: ${totals.vec}/${maxPossible} (${((totals.vec / maxPossible) * 100).toFixed(1)}%)`)
    console.log(`Hybrid total: ${totals.hybrid}/${maxPossible} (${((totals.hybrid / maxPossible) * 100).toFixed(1)}%)`)
    console.log('')

    // Hybrid should generally be >= best single driver
    const bestSingle = Math.max(totals.fts, totals.vec)
    console.log(`Hybrid vs best single: ${totals.hybrid >= bestSingle ? '✓ Hybrid wins/ties' : '✗ Single driver better'}`)

    // Basic assertion - hybrid shouldn't be drastically worse
    expect(totals.hybrid).toBeGreaterThanOrEqual(Math.min(totals.fts, totals.vec))

    await Promise.all([fts.close?.(), vec.close?.(), hybrid.close?.()])
  }, 120000)
})
