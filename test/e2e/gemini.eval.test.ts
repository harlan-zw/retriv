import type { SearchProvider } from '../../src/types'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sqliteFts } from '../../src/db/sqlite-fts'
import { sqliteVec } from '../../src/db/sqlite-vec'
import { transformersJs } from '../../src/embeddings/transformers-js'
import { createRetriv } from '../../src/retriv'
import { loadNuxtDocs } from './fixtures/nuxt-docs'

// A) Binary correctness - factual questions with verifiable answers
// Note: questions should work as search queries (not just natural language)
const factualQuestions = [
  { question: 'nuxt dev server port localhost', keywords: ['3000'] },
  { question: 'middleware global suffix every route', keywords: ['.global'] },
  { question: 'nuxt config file configuration', keywords: ['nuxt.config'] },
  { question: 'server api routes directory folder', keywords: ['server/api', 'server/routes'] },
  { question: 'auto import components directory', keywords: ['components'] },
  { question: 'nuxt generate static site build command', keywords: ['generate', 'nuxi generate'] },
  { question: 'runtime config public environment variable prefix', keywords: ['NUXT_PUBLIC'] },
]

// B) Doc retrieval - questions where we know which content must be retrieved
const retrievalQuestions = [
  { question: 'How do I use useFetch to get data?', mustContain: ['useFetch', 'composable'] },
  { question: 'How do I add global CSS styles?', mustContain: ['css', 'assets', 'style'] },
  { question: 'How do I create API routes in Nuxt?', mustContain: ['server', 'api', 'defineEventHandler'] },
  { question: 'How do I add page meta and SEO tags?', mustContain: ['useHead', 'useSeoMeta'] },
  { question: 'How do I handle errors in Nuxt?', mustContain: ['error', 'createError'] },
  { question: 'How do I use environment variables in Nuxt?', mustContain: ['runtimeConfig', 'env'] },
  { question: 'How do I create layouts in Nuxt?', mustContain: ['layout', 'NuxtLayout'] },
]

// C) Semantic questions - vector should win (synonyms, no keyword overlap)
const semanticQuestions = [
  { question: 'how to reuse logic across multiple components', mustContain: ['composables', 'composable'] },
  { question: 'prevent unauthorized users from accessing certain pages', mustContain: ['middleware', 'route'] },
  { question: 'persist information when navigating between pages', mustContain: ['state', 'useState'] },
  { question: 'render content on server before sending to browser', mustContain: ['ssr', 'server'] },
  { question: 'lazy load components when needed', mustContain: ['lazy', 'Lazy'] },
  { question: 'preload data before user navigates', mustContain: ['prefetch', 'preload'] },
]

function checkAnswer(docs: string, expectedKeywords: string[]): boolean {
  const docsLower = docs.toLowerCase()
  return expectedKeywords.some(kw => docsLower.includes(kw.toLowerCase()))
}

function checkRetrieval(results: Array<{ content?: string }>, mustContain: string[]): boolean {
  const allContent = results.map(r => r.content || '').join(' ').toLowerCase()
  return mustContain.every(term => allContent.includes(term.toLowerCase()))
}

describe('gemini eval', () => {
  let fts: SearchProvider
  let vec: SearchProvider
  let hybrid: SearchProvider

  beforeAll(async () => {
    const docs = await loadNuxtDocs()
    const embeddings = transformersJs({ model: 'Xenova/all-MiniLM-L6-v2', dimensions: 384 })

    fts = await sqliteFts({ path: ':memory:' })
    vec = await sqliteVec({ path: ':memory:', embeddings })
    hybrid = await createRetriv({
      driver: {
        keyword: sqliteFts({ path: ':memory:' }),
        vector: sqliteVec({ path: ':memory:', embeddings }),
      },
    })

    // Index once, reuse for all tests
    await Promise.all([fts.index(docs), vec.index(docs), hybrid.index(docs)])
    console.log(`\nIndexed ${docs.length} docs once for all tests\n`)
  }, 300_000)

  afterAll(async () => {
    await Promise.all([fts.close?.(), vec.close?.(), hybrid.close?.()])
  })

  it('a) binary correctness - can answer factual questions', async () => {
    console.log('\n=== A) Binary Correctness ===\n')
    const scores = { fts: 0, vec: 0, hybrid: 0 }

    for (const { question, keywords } of factualQuestions) {
      const [ftsRes, vecRes, hybridRes] = await Promise.all([
        fts.search(question, { limit: 5, returnContent: true }),
        vec.search(question, { limit: 5, returnContent: true }),
        hybrid.search(question, { limit: 5, returnContent: true }),
      ])

      const format = (r: typeof ftsRes) => r.map(d => d.content || '').join('\n\n')
      const ftsCorrect = checkAnswer(format(ftsRes), keywords)
      const vecCorrect = checkAnswer(format(vecRes), keywords)
      const hybridCorrect = checkAnswer(format(hybridRes), keywords)

      if (ftsCorrect)
        scores.fts++
      if (vecCorrect)
        scores.vec++
      if (hybridCorrect)
        scores.hybrid++

      console.log(`Q: ${question}`)
      console.log(`  FTS: ${ftsCorrect ? '✓' : '✗'} | Vec: ${vecCorrect ? '✓' : '✗'} | Hybrid: ${hybridCorrect ? '✓' : '✗'}`)
    }

    const n = factualQuestions.length
    console.log(`\nScores: FTS ${scores.fts}/${n} | Vec ${scores.vec}/${n} | Hybrid ${scores.hybrid}/${n}`)
    expect(scores.hybrid).toBeGreaterThanOrEqual(scores.fts)
  })

  it('b) doc retrieval - retrieves relevant content', async () => {
    console.log('\n=== B) Doc Retrieval ===\n')
    const scores = { fts: 0, vec: 0, hybrid: 0 }

    for (const { question, mustContain } of retrievalQuestions) {
      const [ftsRes, vecRes, hybridRes] = await Promise.all([
        fts.search(question, { limit: 5, returnContent: true }),
        vec.search(question, { limit: 5, returnContent: true }),
        hybrid.search(question, { limit: 5, returnContent: true }),
      ])

      const ftsHit = checkRetrieval(ftsRes, mustContain)
      const vecHit = checkRetrieval(vecRes, mustContain)
      const hybridHit = checkRetrieval(hybridRes, mustContain)

      if (ftsHit)
        scores.fts++
      if (vecHit)
        scores.vec++
      if (hybridHit)
        scores.hybrid++

      console.log(`Q: ${question}`)
      console.log(`  Must contain: ${mustContain.join(', ')}`)
      console.log(`  FTS: ${ftsHit ? '✓' : '✗'} | Vec: ${vecHit ? '✓' : '✗'} | Hybrid: ${hybridHit ? '✓' : '✗'}`)
    }

    const n = retrievalQuestions.length
    console.log(`\nScores: FTS ${scores.fts}/${n} | Vec ${scores.vec}/${n} | Hybrid ${scores.hybrid}/${n}`)
    expect(scores.hybrid).toBeGreaterThanOrEqual(Math.min(scores.fts, scores.vec))
  })

  it('c) semantic retrieval - vector should outperform FTS', async () => {
    console.log('\n=== C) Semantic Retrieval (Vector should win) ===\n')
    const scores = { fts: 0, vec: 0, hybrid: 0 }

    for (const { question, mustContain } of semanticQuestions) {
      const [ftsRes, vecRes, hybridRes] = await Promise.all([
        fts.search(question, { limit: 5, returnContent: true }),
        vec.search(question, { limit: 5, returnContent: true }),
        hybrid.search(question, { limit: 5, returnContent: true }),
      ])

      const ftsHit = checkRetrieval(ftsRes, mustContain)
      const vecHit = checkRetrieval(vecRes, mustContain)
      const hybridHit = checkRetrieval(hybridRes, mustContain)

      if (ftsHit)
        scores.fts++
      if (vecHit)
        scores.vec++
      if (hybridHit)
        scores.hybrid++

      console.log(`Q: ${question}`)
      console.log(`  Must contain: ${mustContain.join(', ')}`)
      console.log(`  FTS: ${ftsHit ? '✓' : '✗'} | Vec: ${vecHit ? '✓' : '✗'} | Hybrid: ${hybridHit ? '✓' : '✗'}`)
    }

    const n = semanticQuestions.length
    console.log(`\nScores: FTS ${scores.fts}/${n} | Vec ${scores.vec}/${n} | Hybrid ${scores.hybrid}/${n}`)
    expect(scores.vec).toBeGreaterThanOrEqual(scores.fts)
    expect(scores.hybrid).toBeGreaterThanOrEqual(scores.vec)
  })
})
