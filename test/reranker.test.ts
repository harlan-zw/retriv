import type { SearchResult } from '../src/types'
import { describe, expect, it } from 'vitest'
import { cohereReranker } from '../src/rerankers/cohere'
import { crossEncoder } from '../src/rerankers/transformers-js'

describe('cross-encoder reranker', () => {
  it('reranks results by cross-encoder score', async () => {
    const reranker = await crossEncoder().resolve()

    const results: SearchResult[] = [
      { id: '1', score: 0.5, content: 'how to make coffee at home' },
      { id: '2', score: 0.8, content: 'javascript array methods map filter reduce' },
      { id: '3', score: 0.3, content: 'best coffee brewing techniques and tips' },
    ]

    const reranked = await reranker('coffee brewing methods', results)

    expect(reranked).toHaveLength(3)
    expect(reranked.map(r => r.score)).not.toEqual([0.5, 0.8, 0.3])
    expect(['1', '3']).toContain(reranked[0]!.id)
    for (const r of reranked) {
      expect(r.score).toBeGreaterThanOrEqual(0)
      expect(r.score).toBeLessThanOrEqual(1)
    }
  }, 60000)

  it('handles empty results', async () => {
    const reranker = await crossEncoder().resolve()
    const reranked = await reranker('test', [])
    expect(reranked).toEqual([])
  })

  it('passes through results without content unchanged', async () => {
    const reranker = await crossEncoder().resolve()
    const results: SearchResult[] = [
      { id: '1', score: 0.5 },
      { id: '2', score: 0.3 },
    ]
    const reranked = await reranker('test', results)
    expect(reranked).toHaveLength(2)
  })
})

describe('cohere reranker', () => {
  it('exports a RerankerConfig factory', () => {
    const config = cohereReranker()
    expect(config).toHaveProperty('resolve')
    expect(typeof config.resolve).toBe('function')
  })

  it('accepts model and apiKey options', () => {
    const config = cohereReranker({ model: 'rerank-v3.5', apiKey: 'test-key' })
    expect(config).toHaveProperty('resolve')
  })
})
