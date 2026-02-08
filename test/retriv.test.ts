import { describe, expect, it, vi } from 'vitest'
import { markdownChunker } from '../src/chunkers/markdown'
import { sqliteFts } from '../src/db/sqlite-fts'
import { createRetriv } from '../src/retriv'

function mockDriver(results: any[]) {
  return {
    async index() { return { count: 0 } },
    async search() { return results },
  }
}

describe('createRetriv', () => {
  it('works without chunking', async () => {
    const retriv = await createRetriv({
      driver: sqliteFts({ path: ':memory:' }),
    })

    await retriv.index([
      { id: '1', content: 'Hello world', metadata: { source: 'test' } },
      { id: '2', content: 'Goodbye world' },
    ])

    const results = await retriv.search('hello', { limit: 5, returnContent: true })

    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0]!.id).toBe('1')
    expect(results[0]!.content).toBe('Hello world')
    expect(results[0]!._chunk).toBeUndefined()
  })

  it('chunks large documents', async () => {
    const retriv = await createRetriv({
      driver: sqliteFts({ path: ':memory:' }),
      chunking: markdownChunker({ chunkSize: 50, chunkOverlap: 10 }),
    })

    const longContent = 'First section content here.\n\nSecond section with more content.\n\nThird section finale.'

    await retriv.index([
      { id: 'doc1', content: longContent, metadata: { type: 'article' } },
    ])

    const results = await retriv.search('section', {
      limit: 10,
      returnContent: true,
      returnMetadata: true,
    })

    expect(results.length).toBeGreaterThanOrEqual(1)

    const chunkedResult = results.find(r => r._chunk)
    if (chunkedResult) {
      expect(chunkedResult._chunk!.parentId).toBe('doc1')
      expect(typeof chunkedResult._chunk!.index).toBe('number')
      expect(chunkedResult.id).toContain('#chunk-')
    }
  })

  it('preserves metadata through chunking', async () => {
    const retriv = await createRetriv({
      driver: sqliteFts({ path: ':memory:' }),
      chunking: markdownChunker({ chunkSize: 30, chunkOverlap: 0 }),
    })

    await retriv.index([
      { id: 'doc1', content: 'Short text.\n\nAnother paragraph.', metadata: { author: 'test' } },
    ])

    const results = await retriv.search('paragraph', { returnMetadata: true })

    expect(results.length).toBeGreaterThanOrEqual(1)
    const result = results[0]!
    if (result.metadata) {
      expect(result.metadata.author).toBe('test')
      expect(result.metadata._parentId).toBeUndefined()
      expect(result.metadata._chunkIndex).toBeUndefined()
    }
  })

  it('does not chunk small documents', async () => {
    const retriv = await createRetriv({
      driver: sqliteFts({ path: ':memory:' }),
      chunking: markdownChunker({ chunkSize: 1000 }),
    })

    await retriv.index([
      { id: 'small', content: 'Tiny document' },
    ])

    const results = await retriv.search('tiny', { returnContent: true })

    expect(results.length).toBe(1)
    expect(results[0]!.id).toBe('small')
    expect(results[0]!._chunk).toBeUndefined()
  })

  it('generates correct chunk IDs', async () => {
    const retriv = await createRetriv({
      driver: sqliteFts({ path: ':memory:' }),
      chunking: markdownChunker({ chunkSize: 20, chunkOverlap: 0 }),
    })

    await retriv.index([
      { id: 'parent', content: 'First part.\n\nSecond part.\n\nThird part.' },
    ])

    const results = await retriv.search('part', { limit: 10 })

    const chunkIds = results.map(r => r.id)
    expect(chunkIds.some(id => id.startsWith('parent#chunk-'))).toBe(true)
  })

  it('passes through remove/clear/close', async () => {
    const retriv = await createRetriv({
      driver: sqliteFts({ path: ':memory:' }),
    })

    await retriv.index([{ id: '1', content: 'test' }])

    await retriv.remove?.(['1'])
    const afterRemove = await retriv.search('test')
    expect(afterRemove).toHaveLength(0)

    await retriv.index([{ id: '2', content: 'another' }])
    await retriv.clear?.()
    const afterClear = await retriv.search('another')
    expect(afterClear).toHaveLength(0)

    await retriv.close?.()
  })

  it('extracts snippets with highlights', async () => {
    const retriv = await createRetriv({
      driver: sqliteFts({ path: ':memory:' }),
    })

    const longContent = `Introduction to the topic.

This section covers machine learning basics.
Neural networks are a type of machine learning.
Deep learning is a subset of neural networks.

Conclusion with final thoughts.`

    await retriv.index([{ id: 'doc', content: longContent }])

    const results = await retriv.search('machine learning neural', {
      returnContent: true,
      returnMeta: true,
    })

    expect(results.length).toBe(1)
    // Content should be snippet, not full doc
    expect(results[0]!.content!.length).toBeLessThan(longContent.length)
    // Should have highlights
    expect(results[0]!._meta?.highlights).toBeDefined()
    expect(results[0]!._meta?.highlights?.length).toBeGreaterThan(0)
  })

  it('uses custom chunker when provided', async () => {
    const content = 'The quick brown fox jumps over the lazy dog. Another sentence about testing custom chunkers.'
    const customChunker = (text: string) => [
      { text: text.slice(0, 45), range: [0, 45] as [number, number] },
      { text: text.slice(45), range: [45, text.length] as [number, number] },
    ]

    const db = await createRetriv({
      driver: sqliteFts({ path: ':memory:' }),
      chunking: customChunker,
    })

    await db.index([{ id: 'doc1', content }])

    const results = await db.search('chunkers', { returnMetadata: true })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]!._chunk).toBeDefined()
  })

  it('reports onProgress for storing phase', async () => {
    const progress: Array<{ phase: string, current: number, total: number }> = []
    const retriv = await createRetriv({
      driver: sqliteFts({ path: ':memory:' }),
    })

    await retriv.index(
      [
        { id: '1', content: 'Hello world' },
        { id: '2', content: 'Goodbye world' },
        { id: '3', content: 'Another doc' },
      ],
      { onProgress: p => progress.push({ ...p }) },
    )

    // FTS driver only has storing phase
    expect(progress.length).toBe(3)
    expect(progress.every(p => p.phase === 'storing')).toBe(true)
    expect(progress.map(p => p.current)).toEqual([1, 2, 3])
    expect(progress.every(p => p.total === 3)).toBe(true)
  })

  it('reports onProgress chunking phase when chunker enabled', async () => {
    const progress: Array<{ phase: string, current: number, total: number }> = []
    const retriv = await createRetriv({
      driver: sqliteFts({ path: ':memory:' }),
      chunking: markdownChunker({ chunkSize: 20, chunkOverlap: 0 }),
    })

    await retriv.index(
      [
        { id: 'a', content: 'First part.\n\nSecond part.' },
        { id: 'b', content: 'Third part.\n\nFourth part.' },
      ],
      { onProgress: p => progress.push({ ...p }) },
    )

    const chunking = progress.filter(p => p.phase === 'chunking')
    const storing = progress.filter(p => p.phase === 'storing')

    expect(chunking.length).toBe(2)
    expect(chunking.map(p => p.current)).toEqual([1, 2])
    expect(chunking.every(p => p.total === 2)).toBe(true)

    // storing total reflects expanded chunk count
    expect(storing.length).toBeGreaterThan(0)
    expect(storing.at(-1)!.current).toBe(storing.at(-1)!.total)
  })

  it('works fine without onProgress', async () => {
    const retriv = await createRetriv({
      driver: sqliteFts({ path: ':memory:' }),
    })

    // no options arg at all
    await retriv.index([{ id: '1', content: 'test' }])
    // explicit undefined
    await retriv.index([{ id: '2', content: 'test2' }], {})

    const results = await retriv.search('test')
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  // Composed drivers and hybrid sqlite tests are in test/e2e/retriv.test.ts
  // (they require embedding models which are slow to load)
})

describe('reranking', () => {
  it('calls reranker after search and returns reranked order', async () => {
    const rerankerFn = vi.fn(async (_query: string, results: any[]) => {
      return [...results].reverse()
    })

    const retriv = await createRetriv({
      driver: mockDriver([
        { id: 'a', score: 0.9 },
        { id: 'b', score: 0.8 },
        { id: 'c', score: 0.7 },
      ]),
      rerank: { resolve: async () => rerankerFn },
    })

    await retriv.index([])
    const results = await retriv.search('test', { limit: 3 })

    expect(rerankerFn).toHaveBeenCalledOnce()
    expect(rerankerFn).toHaveBeenCalledWith('test', expect.any(Array))
    expect(results.map(r => r.id)).toEqual(['c', 'b', 'a'])
  })

  it('fetches extra results for reranking then trims to limit', async () => {
    const rerankerFn = vi.fn(async (_query: string, results: any[]) => results)

    const driver = mockDriver([
      { id: 'a', score: 0.9 },
      { id: 'b', score: 0.8 },
      { id: 'c', score: 0.7 },
      { id: 'd', score: 0.6 },
    ])
    const searchSpy = vi.spyOn(driver, 'search')

    const retriv = await createRetriv({
      driver,
      rerank: { resolve: async () => rerankerFn },
    })

    await retriv.index([])
    const results = await retriv.search('test', { limit: 2 })

    expect(searchSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ limit: 6 }))
    expect(results).toHaveLength(2)
  })

  it('works without reranker (no-op)', async () => {
    const retriv = await createRetriv({
      driver: mockDriver([{ id: 'a', score: 0.9 }]),
    })

    const results = await retriv.search('test')
    expect(results).toHaveLength(1)
  })
})

describe('split-category search', () => {
  it('searches each category separately and fuses results', async () => {
    const searchSpy = vi.fn(async (_query: string, options?: any) => {
      const cat = options?.filter?.category?.$eq
      if (cat === 'code')
        return [{ id: 'code-1', score: 0.9, content: 'function auth()' }]
      if (cat === 'docs')
        return [{ id: 'doc-1', score: 0.95, content: 'authentication guide' }]
      return []
    })

    const retriv = await createRetriv({
      driver: {
        async index() { return { count: 0 } },
        search: searchSpy,
      },
      categories: () => 'code', // categorize fn required but not called (no index)
    })

    // manually set seen categories since we skip real indexing
    retriv._testSetCategories?.(['code', 'docs'])

    const results = await retriv.search('auth', { limit: 10 })

    expect(searchSpy).toHaveBeenCalledTimes(2)
    const ids = results.map(r => r.id)
    expect(ids).toContain('code-1')
    expect(ids).toContain('doc-1')
  })

  it('auto-tags documents via categorize function during index', async () => {
    const retriv = await createRetriv({
      driver: sqliteFts({ path: ':memory:' }),
      categories: doc => doc.id.endsWith('.ts') ? 'code' : 'docs',
    })

    await retriv.index([
      { id: 'auth.ts', content: 'function authenticate(user) { return true }' },
      { id: 'guide.md', content: 'Authentication guide for setting up JWT' },
    ])

    const results = await retriv.search('authenticate', {
      returnMetadata: true,
    })

    expect(results.length).toBeGreaterThanOrEqual(1)
    // verify metadata was auto-tagged
    const tsResult = results.find(r => r.id === 'auth.ts' || r.id.startsWith('auth.ts'))
    if (tsResult?.metadata)
      expect(tsResult.metadata.category).toBe('code')
  })

  it('merges category filter with user filter', async () => {
    const searchSpy = vi.fn(async (_query: string, _options?: any) => [] as any[])

    const retriv = await createRetriv({
      driver: {
        async index() { return { count: 0 } },
        search: searchSpy,
      },
      categories: () => 'code',
    })

    retriv._testSetCategories?.(['code', 'docs'])

    await retriv.search('test', { filter: { language: 'ts' } })

    for (const call of searchSpy.mock.calls) {
      const opts = call[1]
      expect(opts.filter.language).toBe('ts')
      expect(opts.filter.category).toBeDefined()
    }
  })

  it('works without categories (default behavior unchanged)', async () => {
    const searchSpy = vi.fn(async (_query: string, _options?: any) => [{ id: '1', score: 0.9 }])

    const retriv = await createRetriv({
      driver: {
        async index() { return { count: 0 } },
        search: searchSpy,
      },
    })

    await retriv.index([])
    await retriv.search('test')

    expect(searchSpy).toHaveBeenCalledTimes(1)
    const opts = searchSpy.mock.calls[0][1]
    expect(opts?.filter?.category).toBeUndefined()
  })

  it('respects reranker with categories', async () => {
    const rerankerFn = vi.fn(async (_q: string, results: any[]) => [...results].reverse())
    const searchSpy = vi.fn(async (_query: string, options?: any) => {
      const cat = options?.filter?.category?.$eq
      if (cat === 'a')
        return [{ id: 'a1', score: 0.9 }]
      if (cat === 'b')
        return [{ id: 'b1', score: 0.8 }]
      return []
    })

    const retriv = await createRetriv({
      driver: {
        async index() { return { count: 0 } },
        search: searchSpy,
      },
      categories: () => 'a',
      rerank: { resolve: async () => rerankerFn },
    })

    retriv._testSetCategories?.(['a', 'b'])

    const results = await retriv.search('test', { limit: 2 })

    expect(rerankerFn).toHaveBeenCalledOnce()
    expect(results[0].id).toBe('b1')
  })
})
