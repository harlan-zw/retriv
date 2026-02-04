import type { Document } from '../../src/types'
import { describe, expect, it, vi } from 'vitest'
import { markdownChunker } from '../../src/chunkers/markdown'
import { sqlite } from '../../src/db/sqlite'
import { sqliteFts } from '../../src/db/sqlite-fts'
import { sqliteVec } from '../../src/db/sqlite-vec'
import { createRetriv } from '../../src/retriv'
import { embeddings } from './setup/embeddings'

describe('composed drivers (hybrid)', () => {
  it('accepts vector + keyword composition', async () => {
    const retriv = await createRetriv({
      driver: {
        vector: sqliteVec({ path: ':memory:', embeddings }),
        keyword: sqliteFts({ path: ':memory:' }),
      },
    })

    await retriv.index([
      { id: '1', content: 'apple banana cherry' },
      { id: '2', content: 'banana cherry date' },
    ])

    const results = await retriv.search('banana', { limit: 3 })
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  it('accepts keyword only', async () => {
    const retriv = await createRetriv({
      driver: { keyword: sqliteFts({ path: ':memory:' }) },
    })

    await retriv.index([{ id: '1', content: 'test' }])
    expect(await retriv.search('test')).toHaveLength(1)
  })

  it('accepts vector only', async () => {
    const retriv = await createRetriv({
      driver: { vector: sqliteVec({ path: ':memory:', embeddings }) },
    })

    await retriv.index([{ id: '1', content: 'test' }])
    expect(await retriv.search('test')).toHaveLength(1)
  })

  it('merges results with RRF', async () => {
    const retriv = await createRetriv({
      driver: {
        vector: sqliteVec({ path: ':memory:', embeddings }),
        keyword: sqliteFts({ path: ':memory:' }),
      },
    })

    await retriv.index([
      { id: '1', content: 'machine learning algorithms' },
      { id: '2', content: 'deep learning neural networks' },
      { id: '3', content: 'statistical analysis methods' },
    ])

    const results = await retriv.search('learning', { limit: 3 })

    expect(results.length).toBeGreaterThanOrEqual(1)
    // RRF scores normalized
    expect(results[0]!.score).toBeLessThanOrEqual(1)
    expect(results[0]!.score).toBeGreaterThan(0)
  })

  it('dedupes results across drivers', async () => {
    const retriv = await createRetriv({
      driver: {
        vector: sqliteVec({ path: ':memory:', embeddings }),
        keyword: sqliteFts({ path: ':memory:' }),
      },
    })

    await retriv.index([
      { id: '1', content: 'unique document one' },
      { id: '2', content: 'unique document two' },
    ])

    const results = await retriv.search('unique', { limit: 10 })

    const ids = results.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('applies limit after fusion', async () => {
    const retriv = await createRetriv({
      driver: {
        vector: sqliteVec({ path: ':memory:', embeddings }),
        keyword: sqliteFts({ path: ':memory:' }),
      },
    })

    await retriv.index([
      { id: '1', content: 'test one' },
      { id: '2', content: 'test two' },
      { id: '3', content: 'test three' },
    ])

    const results = await retriv.search('test', { limit: 2 })

    expect(results.length).toBe(2)
  })
})

describe('unified sqlite driver', () => {
  it('provides native hybrid search', async () => {
    const search = await createRetriv({
      driver: sqlite({ path: ':memory:', embeddings }),
    })

    await search.index([
      { id: '1', content: 'machine learning algorithms' },
      { id: '2', content: 'deep learning neural networks' },
      { id: '3', content: 'statistical analysis methods' },
    ])

    const results = await search.search('learning', { limit: 3 })

    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0]!.score).toBeGreaterThan(0)
    expect(results[0]!.score).toBeLessThanOrEqual(1)
  })

  it('returns content and metadata', async () => {
    const search = await createRetriv({
      driver: sqlite({ path: ':memory:', embeddings }),
    })

    await search.index([
      { id: '1', content: 'hello world', metadata: { source: 'test' } },
    ])

    const results = await search.search('hello', {
      returnContent: true,
      returnMetadata: true,
    })

    expect(results[0]!.content).toBe('hello world')
    expect(results[0]!.metadata).toEqual({ source: 'test' })
  })

  it('supports remove and clear', async () => {
    const search = await createRetriv({
      driver: sqlite({ path: ':memory:', embeddings }),
    })

    await search.index([
      { id: '1', content: 'apple fruit nutrition' },
      { id: '2', content: 'quantum physics theory' },
    ])

    await search.remove?.(['1'])
    const results = await search.search('apple fruit', { limit: 5 })
    // Should not find removed doc by ID
    expect(results.find(r => r.id === '1')).toBeUndefined()

    await search.clear?.()
    const afterClear = await search.search('quantum')
    expect(afterClear.length).toBe(0)

    await search.close?.()
  })

  it('supports reranker option', async () => {
    const reranker = vi.fn(async (_query: string, results: any[]) => [...results].reverse())

    const search = await createRetriv({
      driver: sqlite({ path: ':memory:', embeddings }),
      rerank: { resolve: async () => reranker },
    })

    await search.index([
      { id: '1', content: 'machine learning algorithms' },
      { id: '2', content: 'deep learning neural networks' },
    ])

    const results = await search.search('learning', { limit: 2 })
    expect(reranker).toHaveBeenCalledOnce()
    expect(results).toHaveLength(2)
  })

  it('supports chunking', async () => {
    const search = await createRetriv({
      driver: sqlite({ path: ':memory:', embeddings }),
      chunking: markdownChunker({ chunkSize: 50, chunkOverlap: 10 }),
    })

    const longContent = 'First section about machine learning.\n\nSecond section about neural networks.\n\nThird section about deep learning.'

    await search.index([{ id: 'doc1', content: longContent }])

    const results = await search.search('neural networks', { limit: 5 })
    expect(results.length).toBeGreaterThanOrEqual(1)
  })
})

describe('split-category search', () => {
  it('prevents one category from drowning out another', async () => {
    const search = await createRetriv({
      driver: sqlite({ path: ':memory:', embeddings }),
      categories: (doc: Document) => doc.metadata?.category as string || 'other',
    })

    // 3 docs matching "authentication" in docs, 1 in code
    // Without categories, code result would be buried
    await search.index([
      { id: 'fn-auth', content: 'function authenticate(user, pass) { return jwt.sign(user) }', metadata: { category: 'code' } },
      { id: 'guide-auth', content: 'Authentication guide: use JWT tokens for stateless auth. Configure middleware for route protection.', metadata: { category: 'docs' } },
      { id: 'guide-security', content: 'Security best practices for authentication and authorization in web applications.', metadata: { category: 'docs' } },
      { id: 'guide-jwt', content: 'JSON Web Tokens tutorial: creating, verifying, and refreshing authentication tokens.', metadata: { category: 'docs' } },
    ])

    const results = await search.search('authentication', {
      limit: 4,
      returnMetadata: true,
    })

    // Code result should appear despite being outnumbered 3:1 by docs
    const categories = results.map(r => r.metadata?.category)
    expect(categories).toContain('code')
    expect(categories).toContain('docs')

    // Code result should be in top 2 (RRF gives it high rank within its category)
    const codeRank = results.findIndex(r => r.metadata?.category === 'code')
    expect(codeRank).toBeLessThanOrEqual(1)

    await search.close?.()
  })

  it('infers categories from document properties', async () => {
    const search = await createRetriv({
      driver: sqlite({ path: ':memory:', embeddings }),
      categories: (doc: Document) => /\.(?:ts|js)$/.test(doc.id) ? 'code' : 'docs',
    })

    await search.index([
      { id: 'auth.ts', content: 'export function authenticate(user: string) { return true }' },
      { id: 'guide.md', content: 'Authentication setup guide for the project' },
    ])

    const results = await search.search('authenticate', {
      returnMetadata: true,
    })

    expect(results.length).toBeGreaterThanOrEqual(1)
    // verify auto-tagging worked
    for (const r of results) {
      expect(r.metadata?.category).toMatch(/^(code|docs)$/)
    }

    await search.close?.()
  })

  it('falls back to normal search without categories', async () => {
    const search = await createRetriv({
      driver: sqlite({ path: ':memory:', embeddings }),
    })

    await search.index([
      { id: '1', content: 'hello world', metadata: { category: 'docs' } },
    ])

    const results = await search.search('hello')
    expect(results).toHaveLength(1)

    await search.close?.()
  })
})
