import { describe, expect, it } from 'vitest'
import { markdownChunker } from '../src/chunkers/markdown'
import { sqliteFts } from '../src/db/sqlite-fts'
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

  // Composed drivers and hybrid sqlite tests are in test/e2e/retriv.test.ts
  // (they require embedding models which are slow to load)
})
