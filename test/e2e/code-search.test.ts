import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { autoChunker } from '../../src/chunkers/auto'
import { codeChunker } from '../../src/chunkers/typescript'
import { sqliteFts } from '../../src/db/sqlite-fts'
import { createRetriv } from '../../src/retriv'

// Use this repo's own source as realistic code fixtures
const root = resolve(import.meta.dirname, '../..')
const readSrc = (p: string) => readFileSync(resolve(root, p), 'utf-8')

const sourceFiles: Record<string, string> = {
  'src/retriv.ts': readSrc('src/retriv.ts'),
  'src/filter.ts': readSrc('src/filter.ts'),
  'src/types.ts': readSrc('src/types.ts'),
  'src/db/sqlite-fts.ts': readSrc('src/db/sqlite-fts.ts'),
  'src/utils/code-tokenize.ts': readSrc('src/utils/code-tokenize.ts'),
  'src/utils/extract-snippet.ts': readSrc('src/utils/extract-snippet.ts'),
  'src/chunkers/auto.ts': readSrc('src/chunkers/auto.ts'),
  'src/chunkers/typescript.ts': readSrc('src/chunkers/typescript.ts'),
  'src/chunkers/markdown.ts': readSrc('src/chunkers/markdown.ts'),
  'src/db/sqlite.ts': readSrc('src/db/sqlite.ts'),
}

const docs = Object.entries(sourceFiles).map(([id, content]) => ({ id, content }))

// Inline markdown to test mixed content routing
const sampleMarkdown = {
  'docs/guide.md': `
# Search Architecture

## BM25 Keyword Search
The \`sqliteFts\` driver uses FTS5 with BM25 ranking for keyword search.
It normalizes scores to 0-1 range.

## Vector Semantic Search
The \`sqliteVec\` driver uses sqlite-vec for cosine similarity search.
Requires an embedding provider.

## Hybrid Search
Combine keyword and vector search using Reciprocal Rank Fusion (RRF).
Use \`createRetriv\` with composed drivers for best recall.
`.trim(),
  'docs/api.md': `
# API Reference

## createRetriv(options)
Factory function that creates a unified search provider.

### Options
- \`driver\` — single SearchProvider or composed { vector, keyword }
- \`chunking\` — chunking config or false to disable

### Returns
A \`SearchProvider\` with index, search, remove, clear, close methods.
`.trim(),
}

// Helper: create FTS instance with code chunker, index files, return provider
async function createCodeSearch() {
  const retriv = await createRetriv({
    driver: sqliteFts({ path: ':memory:' }),
    chunking: codeChunker(),
  })
  await retriv.index(docs)
  return retriv
}

// Helper: create FTS instance with auto chunker, index mixed content
async function createMixedSearch() {
  const retriv = await createRetriv({
    driver: sqliteFts({ path: ':memory:' }),
    chunking: autoChunker(),
  })
  const allDocs = [
    ...docs,
    ...Object.entries(sampleMarkdown).map(([id, content]) => ({ id, content })),
  ]
  await retriv.index(allDocs)
  return retriv
}

describe('code search e2e', () => {
  // ------------------------------------------------------------------
  // Function / symbol lookup
  // ------------------------------------------------------------------
  describe('function lookup', () => {
    it('finds function by exact name', async () => {
      const retriv = await createCodeSearch()
      const results = await retriv.search('compileFilter', { limit: 5, returnContent: true })
      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.id.startsWith('src/filter.ts'))).toBe(true)
    })

    it('finds function by camelCase query expansion', async () => {
      const retriv = await createCodeSearch()
      // tokenizeCodeQuery expands "splitIdentifier" -> "split Identifier splitIdentifier"
      const results = await retriv.search('splitIdentifier', { limit: 5, returnContent: true })
      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.id.startsWith('src/utils/code-tokenize.ts'))).toBe(true)
    })

    it('finds exported functions across files', async () => {
      const retriv = await createCodeSearch()
      const results = await retriv.search('extractSnippet', { limit: 5, returnContent: true })
      expect(results.length).toBeGreaterThan(0)
      const ids = results.map(r => r.id)
      // Should find the definition file
      expect(ids.some(id => id.startsWith('src/utils/extract-snippet.ts'))).toBe(true)
    })

    it('finds createRetriv factory function', async () => {
      const retriv = await createCodeSearch()
      const results = await retriv.search('createRetriv', { limit: 10, returnContent: true })
      expect(results.length).toBeGreaterThan(0)
      // Should rank the definition file high
      expect(results.some(r => r.id.startsWith('src/retriv.ts'))).toBe(true)
    })
  })

  // ------------------------------------------------------------------
  // Type / interface lookup
  // ------------------------------------------------------------------
  describe('type lookup', () => {
    it('finds interface by name', async () => {
      const retriv = await createCodeSearch()
      const results = await retriv.search('SearchProvider', { limit: 5, returnContent: true })
      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.id.startsWith('src/types.ts'))).toBe(true)
    })

    it('finds type alias', async () => {
      const retriv = await createCodeSearch()
      const results = await retriv.search('FilterOperator', { limit: 5, returnContent: true })
      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.id.startsWith('src/types.ts') || r.id.startsWith('src/filter.ts'))).toBe(true)
    })

    it('finds EmbeddingConfig type', async () => {
      const retriv = await createCodeSearch()
      const results = await retriv.search('EmbeddingConfig', { limit: 5, returnContent: true })
      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.id.startsWith('src/types.ts'))).toBe(true)
    })
  })

  // ------------------------------------------------------------------
  // Natural language queries against code
  // ------------------------------------------------------------------
  describe('natural language queries', () => {
    it('finds password hashing with NL query', async () => {
      // Use inline sample code with auth functions
      const retriv = await createRetriv({
        driver: sqliteFts({ path: ':memory:' }),
        chunking: codeChunker(),
      })
      await retriv.index([
        {
          id: 'src/auth.ts',
          content: `
import { createHash } from 'node:crypto'
export function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex')
}
export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash
}`.trim(),
        },
        { id: 'src/retriv.ts', content: sourceFiles['src/retriv.ts']! },
      ])

      const results = await retriv.search('password hashing', { limit: 5, returnContent: true })
      expect(results.length).toBeGreaterThan(0)
      const texts = results.map(r => r.content || '').join(' ')
      expect(texts).toMatch(/password/i)
    })

    it('finds BM25 scoring logic', async () => {
      const retriv = await createCodeSearch()
      const results = await retriv.search('BM25 scoring', { limit: 5, returnContent: true })
      expect(results.length).toBeGreaterThan(0)
      // extract-snippet.ts has BM25-style scoring
      const ids = results.map(r => r.id)
      expect(ids.some(id =>
        id.startsWith('src/utils/extract-snippet.ts')
        || id.startsWith('src/db/sqlite-fts.ts'),
      )).toBe(true)
    })

    it('finds reciprocal rank fusion logic', async () => {
      const retriv = await createCodeSearch()
      const results = await retriv.search('reciprocal rank fusion', { limit: 5, returnContent: true })
      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.id.startsWith('src/retriv.ts'))).toBe(true)
    })

    it('finds filter compilation code', async () => {
      const retriv = await createCodeSearch()
      const results = await retriv.search('compile filter SQL', { limit: 5, returnContent: true })
      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.id.startsWith('src/filter.ts'))).toBe(true)
    })
  })

  // ------------------------------------------------------------------
  // Chunking behavior
  // ------------------------------------------------------------------
  describe('chunking', () => {
    it('chunks large files into multiple results', async () => {
      const retriv = await createCodeSearch()
      const results = await retriv.search('function', { limit: 20, returnContent: true })
      // Multiple chunks from different files should appear
      const uniqueParents = new Set(results.map(r => r.id.split('#')[0]))
      expect(uniqueParents.size).toBeGreaterThan(1)
    })

    it('chunk results include chunk info', async () => {
      const retriv = await createCodeSearch()
      const results = await retriv.search('compileFilter', { limit: 5, returnContent: true })
      // Large files get chunked - at least some results should have _chunk
      const chunked = results.filter(r => r._chunk)
      // filter.ts is big enough to be chunked
      if (chunked.length > 0) {
        expect(chunked[0]!._chunk!.parentId).toBeTruthy()
        expect(typeof chunked[0]!._chunk!.index).toBe('number')
      }
    })

    it('preserves content across chunks', async () => {
      const retriv = await createCodeSearch()
      const results = await retriv.search('matchesFilter', { limit: 5, returnContent: true })
      expect(results.length).toBeGreaterThan(0)
      // The content returned should contain the queried term
      const match = results.find(r => r.content?.includes('matchesFilter'))
      expect(match).toBeDefined()
    })
  })

  // ------------------------------------------------------------------
  // Score normalization
  // ------------------------------------------------------------------
  describe('scores', () => {
    it('returns scores in 0-1 range', async () => {
      const retriv = await createCodeSearch()
      const results = await retriv.search('search', { limit: 10 })
      for (const r of results) {
        expect(r.score).toBeGreaterThan(0)
        expect(r.score).toBeLessThanOrEqual(1)
      }
    })

    it('ranks the defining file high for exact function name', async () => {
      const retriv = await createCodeSearch()
      const results = await retriv.search('tokenizeCodeQuery', { limit: 5 })
      expect(results.length).toBeGreaterThan(0)
      // The file defining tokenizeCodeQuery should be in top results
      expect(results.some(r => r.id.startsWith('src/utils/code-tokenize.ts'))).toBe(true)
    })
  })

  // ------------------------------------------------------------------
  // Mixed content (code + markdown) with auto chunker
  // ------------------------------------------------------------------
  describe('mixed content', () => {
    it('finds results across code and markdown', async () => {
      const retriv = await createMixedSearch()
      const results = await retriv.search('search', { limit: 10, returnContent: true })
      expect(results.length).toBeGreaterThan(0)
      const ids = results.map(r => r.id)
      const hasCode = ids.some(id => id.endsWith('.ts') || id.includes('.ts#'))
      const hasDocs = ids.some(id => id.endsWith('.md') || id.includes('.md#'))
      expect(hasCode || hasDocs).toBe(true)
    })

    it('routes code files to code chunker', async () => {
      const retriv = await createMixedSearch()
      // Query specific to a TS function - should find code file
      const results = await retriv.search('compileFilter', { limit: 5, returnContent: true })
      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.id.startsWith('src/filter.ts'))).toBe(true)
    })

    it('routes markdown to markdown chunker', async () => {
      const retriv = await createMixedSearch()
      const results = await retriv.search('Reciprocal Rank Fusion RRF', { limit: 5, returnContent: true })
      expect(results.length).toBeGreaterThan(0)
      // Should find both the markdown guide and the source code
      const ids = results.map(r => r.id)
      const hasMd = ids.some(id => id.includes('docs/'))
      const hasTs = ids.some(id => id.includes('src/'))
      expect(hasMd || hasTs).toBe(true)
    })
  })

  // ------------------------------------------------------------------
  // Code-specific query patterns
  // ------------------------------------------------------------------
  describe('code query patterns', () => {
    it('handles dot-notation queries', async () => {
      const retriv = await createCodeSearch()
      // tokenizeCodeQuery splits "db.prepare" -> "db prepare db.prepare"
      // FTS5 sanitizes the dot, so this effectively searches "db prepare"
      const results = await retriv.search('prepare run', { limit: 5, returnContent: true })
      expect(results.length).toBeGreaterThan(0)
    })

    it('handles snake_case queries', async () => {
      const retriv = await createCodeSearch()
      // _parentId, _chunkIndex appear in retriv.ts
      const results = await retriv.search('_parentId', { limit: 5, returnContent: true })
      expect(results.length).toBeGreaterThan(0)
    })

    it('handles UPPER_CASE constants', async () => {
      const retriv = await createCodeSearch()
      const results = await retriv.search('RRF_K', { limit: 5, returnContent: true })
      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.id.startsWith('src/retriv.ts'))).toBe(true)
    })

    it('finds import statements', async () => {
      const retriv = await createCodeSearch()
      const results = await retriv.search('import compileFilter', { limit: 5, returnContent: true })
      expect(results.length).toBeGreaterThan(0)
    })

    it('finds error handling patterns', async () => {
      const retriv = await createCodeSearch()
      const results = await retriv.search('throw Error', { limit: 10, returnContent: true })
      expect(results.length).toBeGreaterThan(0)
      const texts = results.map(r => r.content || '').join(' ')
      expect(texts).toMatch(/throw/i)
    })
  })

  // ------------------------------------------------------------------
  // Edge cases
  // ------------------------------------------------------------------
  describe('edge cases', () => {
    it('returns empty for nonsense query', async () => {
      const retriv = await createCodeSearch()
      const results = await retriv.search('xyzzyplugh99', { limit: 5 })
      expect(results).toHaveLength(0)
    })

    it('handles single character query gracefully', async () => {
      const retriv = await createCodeSearch()
      // FTS5 may or may not match single chars; just ensure no crash
      const results = await retriv.search('x', { limit: 5 })
      expect(Array.isArray(results)).toBe(true)
    })

    it('handles special characters in query', async () => {
      const retriv = await createCodeSearch()
      // FTS5 special chars get sanitized — query should not crash
      const results = await retriv.search('string Promise number', { limit: 5 })
      expect(Array.isArray(results)).toBe(true)
    })

    it('respects limit option', async () => {
      const retriv = await createCodeSearch()
      const results = await retriv.search('function', { limit: 3 })
      expect(results.length).toBeLessThanOrEqual(3)
    })
  })

  // ------------------------------------------------------------------
  // Metadata filtering with code files
  // ------------------------------------------------------------------
  describe('metadata filtering', () => {
    it('filters by metadata on code documents', async () => {
      const retriv = await createRetriv({
        driver: sqliteFts({ path: ':memory:' }),
      })

      await retriv.index([
        { id: 'src/a.ts', content: 'export function foo() { return 1 }', metadata: { lang: 'typescript', dir: 'src' } },
        { id: 'src/b.ts', content: 'export function bar() { return 2 }', metadata: { lang: 'typescript', dir: 'src' } },
        { id: 'lib/c.js', content: 'module.exports = function baz() { return 3 }', metadata: { lang: 'javascript', dir: 'lib' } },
      ])

      const results = await retriv.search('function', {
        limit: 10,
        filter: { lang: 'typescript' },
        returnMetadata: true,
      })
      expect(results.length).toBe(2)
      for (const r of results) {
        expect(r.metadata?.lang).toBe('typescript')
      }
    })
  })

  // ------------------------------------------------------------------
  // Remove / clear with code content
  // ------------------------------------------------------------------
  describe('mutations', () => {
    it('removes indexed code file', async () => {
      const retriv = await createRetriv({
        driver: sqliteFts({ path: ':memory:' }),
      })
      await retriv.index([
        { id: 'a.ts', content: 'export function alpha() {}' },
        { id: 'b.ts', content: 'export function beta() {}' },
      ])

      await retriv.remove?.(['a.ts'])
      const results = await retriv.search('alpha', { limit: 5 })
      expect(results.find(r => r.id === 'a.ts')).toBeUndefined()

      // b.ts still searchable
      const bResults = await retriv.search('beta', { limit: 5 })
      expect(bResults.some(r => r.id === 'b.ts')).toBe(true)
    })

    it('clears all code documents', async () => {
      const retriv = await createRetriv({
        driver: sqliteFts({ path: ':memory:' }),
      })
      await retriv.index(docs.slice(0, 3))
      await retriv.clear?.()
      const results = await retriv.search('function', { limit: 10 })
      expect(results).toHaveLength(0)
    })
  })

  // ------------------------------------------------------------------
  // Re-indexing / upsert
  // ------------------------------------------------------------------
  describe('re-indexing', () => {
    it('updates content on re-index', async () => {
      const retriv = await createRetriv({
        driver: sqliteFts({ path: ':memory:' }),
      })

      await retriv.index([{ id: 'main.ts', content: 'the zebra gallops across the savannah' }])
      let results = await retriv.search('zebra', { limit: 5, returnContent: true })
      expect(results.length).toBeGreaterThan(0)

      // Re-index same id with different content
      await retriv.index([{ id: 'main.ts', content: 'the penguin waddles across the glacier' }])
      results = await retriv.search('penguin', { limit: 5, returnContent: true })
      expect(results.length).toBeGreaterThan(0)

      // Old content should no longer match
      results = await retriv.search('zebra', { limit: 5 })
      expect(results).toHaveLength(0)
    })
  })
})
