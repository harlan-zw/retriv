import { describe, expect, it } from 'vitest'
import { extractSnippet } from '../src/utils/extract-snippet'

describe('extractSnippet', () => {
  const content = [
    'Introduction to search',
    'Full-text search uses BM25 ranking',
    'Vector search uses embeddings',
    'Hybrid search combines both approaches',
    'Node.js is required for this library',
    'C++ bindings are not needed',
    'The [config] section defines options',
  ].join('\n')

  it('returns snippet around best matching line', () => {
    const { snippet, highlights } = extractSnippet(content, 'BM25 ranking')
    expect(snippet).toContain('BM25')
    expect(highlights.length).toBeGreaterThan(0)
  })

  it('handles regex special characters in query without throwing', () => {
    expect(() => extractSnippet(content, 'C++ bindings')).not.toThrow()
    const { snippet } = extractSnippet(content, 'C++ bindings')
    expect(snippet).toContain('C++')
  })

  it('handles dot in query literally', () => {
    const { snippet } = extractSnippet(content, 'Node.js')
    expect(snippet).toContain('Node.js')
  })

  it('handles brackets in query without throwing', () => {
    expect(() => extractSnippet(content, '[config] section')).not.toThrow()
    const { snippet } = extractSnippet(content, '[config] section')
    expect(snippet).toContain('[config]')
  })

  it('returns full content when short enough', () => {
    const short = 'hello world'
    const { snippet } = extractSnippet(short, 'hello')
    expect(snippet).toBe(short)
  })

  it('returns highlights scored by BM25', () => {
    const { highlights } = extractSnippet(content, 'hybrid search embeddings')
    expect(highlights.length).toBeGreaterThan(0)
    expect(highlights.length).toBeLessThanOrEqual(5)
  })
})
