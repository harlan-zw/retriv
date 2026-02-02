import { describe, expect, it } from 'vitest'
import { sqlite } from '../src/db/sqlite'
import { sqliteFts } from '../src/db/sqlite-fts'
import { sqliteVec } from '../src/db/sqlite-vec'
import { transformersJs } from '../src/embeddings/transformers-js'
import { createRetriv } from '../src/retriv'

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
      chunking: {
        chunkSize: 50,
        chunkOverlap: 10,
      },
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
      chunking: { chunkSize: 30, chunkOverlap: 0 },
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
      chunking: { chunkSize: 1000 },
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
      chunking: { chunkSize: 20, chunkOverlap: 0 },
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

  describe('composed drivers (hybrid)', () => {
    const embeddings = transformersJs({ model: 'Xenova/all-MiniLM-L6-v2' })

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
    const embeddings = transformersJs({ model: 'Xenova/all-MiniLM-L6-v2' })

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

    it('supports chunking', async () => {
      const search = await createRetriv({
        driver: sqlite({ path: ':memory:', embeddings }),
        chunking: { chunkSize: 50, chunkOverlap: 10 },
      })

      const longContent = 'First section about machine learning.\n\nSecond section about neural networks.\n\nThird section about deep learning.'

      await search.index([{ id: 'doc1', content: longContent }])

      const results = await search.search('neural networks', { limit: 5 })
      expect(results.length).toBeGreaterThanOrEqual(1)
    })
  })
})
