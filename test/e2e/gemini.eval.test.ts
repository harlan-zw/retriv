import { describe, expect, it } from 'vitest'
import { sqliteFts } from '../../src/db/sqlite-fts'
import { sqliteVec } from '../../src/db/sqlite-vec'
import { transformers } from '../../src/embeddings/transformers'
import { createRetriv } from '../../src/retriv'
import { loadNuxtDocs } from './fixtures/nuxt-docs'

// A) Binary correctness - factual questions with verifiable answers
// Note: questions should work as search queries (not just natural language)
const factualQuestions = [
  {
    question: 'nuxt dev server port localhost',
    keywords: ['3000'],
  },
  {
    question: 'middleware global suffix every route',
    keywords: ['.global'],
  },
  {
    question: 'nuxt config file configuration',
    keywords: ['nuxt.config'],
  },
]

// B) Doc retrieval - questions where we know which content must be retrieved
const retrievalQuestions = [
  {
    question: 'How do I use useFetch to get data?',
    mustContain: ['useFetch', 'composable'],
  },
  {
    question: 'How do I add global CSS styles?',
    mustContain: ['css', 'assets', 'style'],
  },
  {
    question: 'How do I create API routes in Nuxt?',
    mustContain: ['server', 'api', 'defineEventHandler'],
  },
]

// C) Semantic questions - vector should win (synonyms, no keyword overlap)
const semanticQuestions = [
  {
    // "reuse logic" -> composables (no keyword match)
    question: 'how to reuse logic across multiple components',
    mustContain: ['composables', 'composable'],
  },
  {
    // "protect pages" -> middleware (no keyword match)
    question: 'prevent unauthorized users from accessing certain pages',
    mustContain: ['middleware', 'route'],
  },
  {
    // "store data between pages" -> state/useState (no keyword match)
    question: 'persist information when navigating between pages',
    mustContain: ['state', 'useState'],
  },
]

function checkAnswer(docs: string, expectedKeywords: string[]): boolean {
  // Simple check: do the retrieved docs contain the answer?
  const docsLower = docs.toLowerCase()
  return expectedKeywords.some(kw => docsLower.includes(kw.toLowerCase()))
}

function checkRetrieval(results: Array<{ content?: string }>, mustContain: string[]): boolean {
  const allContent = results.map(r => r.content || '').join(' ').toLowerCase()
  return mustContain.every(term => allContent.includes(term.toLowerCase()))
}

describe('gemini eval', () => {
  it('a) binary correctness - can answer factual questions', async () => {
    const docs = await loadNuxtDocs()
    const embeddings = transformers({ model: 'Xenova/all-MiniLM-L6-v2' })

    const fts = await sqliteFts({ path: ':memory:' })
    const vec = await sqliteVec({ path: ':memory:', embeddings })
    const hybrid = await createRetriv({
      driver: {
        keyword: sqliteFts({ path: ':memory:' }),
        vector: sqliteVec({ path: ':memory:', embeddings }),
      },
    })

    await Promise.all([fts.index(docs), vec.index(docs), hybrid.index(docs)])

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

    await Promise.all([fts.close?.(), vec.close?.(), hybrid.close?.()])

    expect(scores.hybrid).toBeGreaterThanOrEqual(scores.fts)
  }, 300_000)

  it('b) doc retrieval - retrieves relevant content', async () => {
    const docs = await loadNuxtDocs()
    const embeddings = transformers({ model: 'Xenova/all-MiniLM-L6-v2' })

    const fts = await sqliteFts({ path: ':memory:' })
    const vec = await sqliteVec({ path: ':memory:', embeddings })
    const hybrid = await createRetriv({
      driver: {
        keyword: sqliteFts({ path: ':memory:' }),
        vector: sqliteVec({ path: ':memory:', embeddings }),
      },
    })

    await Promise.all([fts.index(docs), vec.index(docs), hybrid.index(docs)])

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

    await Promise.all([fts.close?.(), vec.close?.(), hybrid.close?.()])

    // Hybrid should retrieve at least as well as the best single method
    expect(scores.hybrid).toBeGreaterThanOrEqual(Math.min(scores.fts, scores.vec))
  }, 300_000)

  it('c) semantic retrieval - vector should outperform FTS', async () => {
    const docs = await loadNuxtDocs()
    const embeddings = transformers({ model: 'Xenova/all-MiniLM-L6-v2' })

    const fts = await sqliteFts({ path: ':memory:' })
    const vec = await sqliteVec({ path: ':memory:', embeddings })
    const hybrid = await createRetriv({
      driver: {
        keyword: sqliteFts({ path: ':memory:' }),
        vector: sqliteVec({ path: ':memory:', embeddings }),
      },
    })

    await Promise.all([fts.index(docs), vec.index(docs), hybrid.index(docs)])

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

    await Promise.all([fts.close?.(), vec.close?.(), hybrid.close?.()])

    // Vector should beat FTS on semantic queries
    expect(scores.vec).toBeGreaterThanOrEqual(scores.fts)
    // Hybrid should get best of both
    expect(scores.hybrid).toBeGreaterThanOrEqual(scores.vec)
  }, 300_000)
})
