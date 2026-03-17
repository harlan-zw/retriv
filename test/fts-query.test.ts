import { describe, expect, it } from 'vitest'
import { buildFtsQuery, sanitizeFtsTokens } from '../src/db/sqlite-fts'

describe('sanitizeFtsTokens', () => {
  it('strips FTS5 special characters', () => {
    expect(sanitizeFtsTokens('hello "world"')).toEqual(['hello', 'world'])
    expect(sanitizeFtsTokens('foo:bar')).toEqual(['foo', 'bar'])
    expect(sanitizeFtsTokens('(a OR b)')).toEqual(['a', 'OR', 'b'])
  })

  it('splits on whitespace', () => {
    expect(sanitizeFtsTokens('hello   world')).toEqual(['hello', 'world'])
  })

  it('filters empty tokens', () => {
    expect(sanitizeFtsTokens('   ')).toEqual([])
    expect(sanitizeFtsTokens('')).toEqual([])
  })
})

describe('buildFtsQuery', () => {
  it('returns empty for no tokens', () => {
    expect(buildFtsQuery([])).toBe('')
  })

  it('quotes single token', () => {
    expect(buildFtsQuery(['hello'])).toBe('"hello"')
  })

  it('joins with implicit AND by default', () => {
    expect(buildFtsQuery(['hello', 'world'])).toBe('"hello" "world"')
  })

  it('joins with explicit OR', () => {
    expect(buildFtsQuery(['hello', 'world'], 'or')).toBe('"hello" OR "world"')
  })

  it('quotes FTS5 keywords to prevent operator collision', () => {
    // "not available" should search for both words, not negate "available"
    expect(buildFtsQuery(['not', 'available'])).toBe('"not" "available"')
    expect(buildFtsQuery(['or', 'else'])).toBe('"or" "else"')
    expect(buildFtsQuery(['this', 'and', 'that'])).toBe('"this" "and" "that"')
  })
})

describe('fts5 keyword integration', () => {
  it('searching for "not" does not negate results', async () => {
    const { sqliteFts } = await import('../src/db/sqlite-fts')
    const db = await sqliteFts({ path: ':memory:' })
    await db.index([
      { id: '1', content: 'feature not available yet' },
      { id: '2', content: 'feature is ready' },
    ])
    const results = await db.search('not available')
    // Should find doc1 (contains both "not" and "available")
    // Without quoting, FTS5 interprets "not available" as NOT "available",
    // which would return doc2 instead
    expect(results.some(r => r.id === '1')).toBe(true)
    await db.close?.()
  })
})
