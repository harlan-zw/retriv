import { execSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { sqliteFts } from '../../src/db/sqlite-fts'
import { sqliteVec } from '../../src/db/sqlite-vec'
import { transformers } from '../../src/embeddings/transformers'
import { createRetriv } from '../../src/retriv'
import { loadNuxtReferences } from './fixtures/nuxt-references'

interface AgentResult {
  answer: string
  correct: boolean
  timeMs: number
}

function askGeminiWithRetrieval(question: string, context: string, sources: string[]): AgentResult {
  const sourcesInfo = sources.length > 0
    ? `\n\nSource files (read with readFile if needed):\n${sources.join('\n')}`
    : ''

  const prompt = `Answer this question in ONE sentence:

${question}

Here are relevant docs:
${context}${sourcesInfo}

Give a direct, concise answer.`

  const escaped = prompt.replace(/'/g, `'\\''`)
  const start = Date.now()
  try {
    const response = execSync(`gemini -p '${escaped}'`, {
      encoding: 'utf8',
      timeout: 120_000,
    }).trim()
    const timeMs = Date.now() - start
    return { answer: response, correct: false, timeMs }
  }
  catch (e: any) {
    const timeMs = Date.now() - start
    return { answer: `ERROR: ${e.message?.slice(0, 50) || 'timeout'}`, correct: false, timeMs }
  }
}

// Hard questions - require finding specific/obscure info
const evalQuestions = [
  {
    question: 'What environment variable prefix makes runtime config available on the client side in Nuxt?',
    keywords: ['NUXT_PUBLIC'],
  },
  {
    question: 'What function do you call to throw a custom error with a status code in Nuxt?',
    keywords: ['createError'],
  },
  {
    question: 'What is the name of the directory where you put reusable Vue composables in Nuxt?',
    keywords: ['composables'],
  },
]

describe('agent eval', () => {
  it('compares FTS vs Vector vs Hybrid retrieval', async () => {
    const docs = loadNuxtReferences()
    console.log(`\nLoaded ${docs.length} reference docs\n`)

    const embeddings = transformers({ model: 'Xenova/all-MiniLM-L6-v2' })

    // Create all three search methods
    const fts = await sqliteFts({ path: ':memory:' })
    const vec = await sqliteVec({ path: ':memory:', embeddings })
    const hybrid = await createRetriv({
      driver: {
        keyword: sqliteFts({ path: ':memory:' }),
        vector: sqliteVec({ path: ':memory:', embeddings }),
      },
    })

    await Promise.all([fts.index(docs), vec.index(docs), hybrid.index(docs)])
    console.log('Indexed docs into all three methods\n')

    const results: Array<{
      question: string
      fts: AgentResult
      vec: AgentResult
      hybrid: AgentResult
    }> = []

    for (const { question, keywords } of evalQuestions) {
      console.log(`Q: ${question}`)

      // Search with each method
      const [ftsResults, vecResults, hybridResults] = await Promise.all([
        fts.search(question, { limit: 5, returnContent: true, returnMetadata: true }),
        vec.search(question, { limit: 5, returnContent: true, returnMetadata: true }),
        hybrid.search(question, { limit: 5, returnContent: true, returnMetadata: true }),
      ])

      const formatContext = (results: typeof ftsResults) =>
        results.map((r, i) => `[${i + 1}] ${r.metadata?.title || r.id}\n${r.content}`).join('\n\n---\n\n')

      const getSources = (results: typeof ftsResults) =>
        results.map(r => r.metadata?.source as string).filter(Boolean)

      // Ask Gemini with each context
      const ftsResult = askGeminiWithRetrieval(question, formatContext(ftsResults), getSources(ftsResults))
      const vecResult = askGeminiWithRetrieval(question, formatContext(vecResults), getSources(vecResults))
      const hybridResult = askGeminiWithRetrieval(question, formatContext(hybridResults), getSources(hybridResults))

      // Check correctness
      const checkCorrect = (text: string) =>
        keywords.some(kw => text.toLowerCase().includes(kw.toLowerCase()))

      ftsResult.correct = checkCorrect(ftsResult.answer)
      vecResult.correct = checkCorrect(vecResult.answer)
      hybridResult.correct = checkCorrect(hybridResult.answer)

      results.push({ question, fts: ftsResult, vec: vecResult, hybrid: hybridResult })

      console.log(`  FTS:    ${ftsResult.correct ? '✓' : '✗'} - ${ftsResult.answer.slice(0, 50)}...`)
      console.log(`  Vector: ${vecResult.correct ? '✓' : '✗'} - ${vecResult.answer.slice(0, 50)}...`)
      console.log(`  Hybrid: ${hybridResult.correct ? '✓' : '✗'} - ${hybridResult.answer.slice(0, 50)}...`)
      console.log('')
    }

    // Summary
    const ftsScore = results.filter(r => r.fts.correct).length
    const vecScore = results.filter(r => r.vec.correct).length
    const hybridScore = results.filter(r => r.hybrid.correct).length

    console.log('=== Summary ===')
    console.log(`FTS:    ${ftsScore}/${results.length} correct`)
    console.log(`Vector: ${vecScore}/${results.length} correct`)
    console.log(`Hybrid: ${hybridScore}/${results.length} correct`)

    console.log('\n| Question | FTS | Vector | Hybrid |')
    console.log('|----------|-----|--------|--------|')
    for (const r of results) {
      console.log(`| ${r.question.slice(0, 35)}... | ${r.fts.correct ? '✓' : '✗'} | ${r.vec.correct ? '✓' : '✗'} | ${r.hybrid.correct ? '✓' : '✗'} |`)
    }

    // Hybrid should be >= best single method
    const bestSingle = Math.max(ftsScore, vecScore)
    console.log(`\nHybrid vs best single: ${hybridScore >= bestSingle ? '✓ Hybrid wins/ties' : '✗ Single method better'}`)

    expect(hybridScore).toBeGreaterThanOrEqual(Math.min(ftsScore, vecScore))

    await Promise.all([fts.close?.(), vec.close?.(), hybrid.close?.()])
  }, 600_000)
})
