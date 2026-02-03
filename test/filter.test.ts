import type { FilterValue, SearchFilter } from '../src/types'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { compileFilter, matchesFilter, pgParams } from '../src/filter'

describe('searchFilter types', () => {
  it('filterValue accepts primitives and operators', () => {
    expectTypeOf<string>().toMatchTypeOf<FilterValue>()
    expectTypeOf<number>().toMatchTypeOf<FilterValue>()
    expectTypeOf<boolean>().toMatchTypeOf<FilterValue>()
    expectTypeOf<{ $gt: number }>().toMatchTypeOf<FilterValue>()
    expectTypeOf<{ $in: string[] }>().toMatchTypeOf<FilterValue>()
    expectTypeOf<{ $prefix: string }>().toMatchTypeOf<FilterValue>()
    expectTypeOf<{ $exists: boolean }>().toMatchTypeOf<FilterValue>()
  })

  it('searchFilter is assignable from concrete filters', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const filters: SearchFilter[] = [
      { category: 'blog' },
      { score: { $gt: 5 } },
      { tag: { $in: ['a', 'b'] }, active: true },
    ]
    expect(filters).toHaveLength(3)
  })
})

describe('compileFilter', () => {
  it('returns empty for undefined filter', () => {
    expect(compileFilter(undefined, 'json')).toEqual({ sql: '', params: [] })
  })

  it('returns empty for empty filter', () => {
    expect(compileFilter({}, 'json')).toEqual({ sql: '', params: [] })
  })

  describe('json mode (SQLite)', () => {
    it('compiles exact match', () => {
      const result = compileFilter({ category: 'blog' }, 'json')
      expect(result.sql).toBe(`json_extract(metadata, '$.category') = ?`)
      expect(result.params).toEqual(['blog'])
    })

    it('compiles $eq', () => {
      const result = compileFilter({ status: { $eq: 'active' } }, 'json')
      expect(result.sql).toBe(`json_extract(metadata, '$.status') = ?`)
      expect(result.params).toEqual(['active'])
    })

    it('compiles $ne', () => {
      const result = compileFilter({ status: { $ne: 'deleted' } }, 'json')
      expect(result.sql).toBe(`json_extract(metadata, '$.status') != ?`)
      expect(result.params).toEqual(['deleted'])
    })

    it('compiles $gt', () => {
      const result = compileFilter({ score: { $gt: 5 } }, 'json')
      expect(result.sql).toBe(`json_extract(metadata, '$.score') > ?`)
      expect(result.params).toEqual([5])
    })

    it('compiles $gte', () => {
      const result = compileFilter({ score: { $gte: 5 } }, 'json')
      expect(result.sql).toBe(`json_extract(metadata, '$.score') >= ?`)
      expect(result.params).toEqual([5])
    })

    it('compiles $lt', () => {
      const result = compileFilter({ score: { $lt: 10 } }, 'json')
      expect(result.sql).toBe(`json_extract(metadata, '$.score') < ?`)
      expect(result.params).toEqual([10])
    })

    it('compiles $lte', () => {
      const result = compileFilter({ score: { $lte: 10 } }, 'json')
      expect(result.sql).toBe(`json_extract(metadata, '$.score') <= ?`)
      expect(result.params).toEqual([10])
    })

    it('compiles $in', () => {
      const result = compileFilter({ tag: { $in: ['a', 'b', 'c'] } }, 'json')
      expect(result.sql).toBe(`json_extract(metadata, '$.tag') IN (?, ?, ?)`)
      expect(result.params).toEqual(['a', 'b', 'c'])
    })

    it('compiles $prefix', () => {
      const result = compileFilter({ path: { $prefix: '/docs/' } }, 'json')
      expect(result.sql).toBe(`json_extract(metadata, '$.path') LIKE ?`)
      expect(result.params).toEqual(['/docs/%'])
    })

    it('compiles $exists true', () => {
      const result = compileFilter({ image: { $exists: true } }, 'json')
      expect(result.sql).toBe(`json_extract(metadata, '$.image') IS NOT NULL`)
      expect(result.params).toEqual([])
    })

    it('compiles $exists false', () => {
      const result = compileFilter({ image: { $exists: false } }, 'json')
      expect(result.sql).toBe(`json_extract(metadata, '$.image') IS NULL`)
      expect(result.params).toEqual([])
    })

    it('compiles multiple fields with AND', () => {
      const result = compileFilter({ category: 'blog', score: { $gt: 5 } }, 'json')
      expect(result.sql).toBe(
        `json_extract(metadata, '$.category') = ? AND json_extract(metadata, '$.score') > ?`,
      )
      expect(result.params).toEqual(['blog', 5])
    })
  })

  describe('jsonb mode (PostgreSQL)', () => {
    it('compiles exact match', () => {
      const result = compileFilter({ category: 'blog' }, 'jsonb')
      expect(result.sql).toBe(`metadata->>'category' = ?`)
      expect(result.params).toEqual(['blog'])
    })

    it('compiles $in', () => {
      const result = compileFilter({ tag: { $in: [1, 2] } }, 'jsonb')
      expect(result.sql).toBe(`metadata->>'tag' IN (?, ?)`)
      expect(result.params).toEqual([1, 2])
    })

    it('compiles $prefix', () => {
      const result = compileFilter({ name: { $prefix: 'foo' } }, 'jsonb')
      expect(result.sql).toBe(`metadata->>'name' LIKE ?`)
      expect(result.params).toEqual(['foo%'])
    })
  })
})

describe('matchesFilter', () => {
  it('returns true for undefined filter', () => {
    expect(matchesFilter(undefined, { a: 1 })).toBe(true)
  })

  it('returns true for empty filter', () => {
    expect(matchesFilter({}, { a: 1 })).toBe(true)
  })

  it('returns false for missing metadata', () => {
    expect(matchesFilter({ a: 1 }, undefined)).toBe(false)
  })

  it('matches exact string', () => {
    expect(matchesFilter({ lang: 'en' }, { lang: 'en' })).toBe(true)
    expect(matchesFilter({ lang: 'en' }, { lang: 'fr' })).toBe(false)
  })

  it('matches exact number', () => {
    expect(matchesFilter({ count: 3 }, { count: 3 })).toBe(true)
    expect(matchesFilter({ count: 3 }, { count: 4 })).toBe(false)
  })

  it('matches exact boolean', () => {
    expect(matchesFilter({ active: true }, { active: true })).toBe(true)
    expect(matchesFilter({ active: true }, { active: false })).toBe(false)
  })

  it('matches $eq', () => {
    expect(matchesFilter({ x: { $eq: 'a' } }, { x: 'a' })).toBe(true)
    expect(matchesFilter({ x: { $eq: 'a' } }, { x: 'b' })).toBe(false)
  })

  it('matches $ne', () => {
    expect(matchesFilter({ x: { $ne: 'a' } }, { x: 'b' })).toBe(true)
    expect(matchesFilter({ x: { $ne: 'a' } }, { x: 'a' })).toBe(false)
  })

  it('matches $gt', () => {
    expect(matchesFilter({ x: { $gt: 5 } }, { x: 6 })).toBe(true)
    expect(matchesFilter({ x: { $gt: 5 } }, { x: 5 })).toBe(false)
    expect(matchesFilter({ x: { $gt: 5 } }, { x: 4 })).toBe(false)
  })

  it('matches $gte', () => {
    expect(matchesFilter({ x: { $gte: 5 } }, { x: 5 })).toBe(true)
    expect(matchesFilter({ x: { $gte: 5 } }, { x: 6 })).toBe(true)
    expect(matchesFilter({ x: { $gte: 5 } }, { x: 4 })).toBe(false)
  })

  it('matches $lt', () => {
    expect(matchesFilter({ x: { $lt: 5 } }, { x: 4 })).toBe(true)
    expect(matchesFilter({ x: { $lt: 5 } }, { x: 5 })).toBe(false)
  })

  it('matches $lte', () => {
    expect(matchesFilter({ x: { $lte: 5 } }, { x: 5 })).toBe(true)
    expect(matchesFilter({ x: { $lte: 5 } }, { x: 4 })).toBe(true)
    expect(matchesFilter({ x: { $lte: 5 } }, { x: 6 })).toBe(false)
  })

  it('matches $in', () => {
    expect(matchesFilter({ x: { $in: ['a', 'b'] } }, { x: 'a' })).toBe(true)
    expect(matchesFilter({ x: { $in: ['a', 'b'] } }, { x: 'c' })).toBe(false)
    expect(matchesFilter({ x: { $in: [1, 2] } }, { x: 2 })).toBe(true)
  })

  it('matches $prefix', () => {
    expect(matchesFilter({ path: { $prefix: '/docs/' } }, { path: '/docs/intro' })).toBe(true)
    expect(matchesFilter({ path: { $prefix: '/docs/' } }, { path: '/blog/post' })).toBe(false)
  })

  it('$prefix returns false for non-string', () => {
    expect(matchesFilter({ x: { $prefix: 'foo' } }, { x: 123 })).toBe(false)
  })

  it('matches $exists true', () => {
    expect(matchesFilter({ img: { $exists: true } }, { img: 'url' })).toBe(true)
    expect(matchesFilter({ img: { $exists: true } }, { other: 1 })).toBe(false)
  })

  it('matches $exists false', () => {
    expect(matchesFilter({ img: { $exists: false } }, { other: 1 })).toBe(true)
    expect(matchesFilter({ img: { $exists: false } }, { img: 'url' })).toBe(false)
  })

  it('$gt returns false for non-number', () => {
    expect(matchesFilter({ x: { $gt: 5 } }, { x: 'hello' })).toBe(false)
  })

  it('aND semantics for multiple fields', () => {
    expect(matchesFilter({ a: 1, b: 'x' }, { a: 1, b: 'x', c: true })).toBe(true)
    expect(matchesFilter({ a: 1, b: 'x' }, { a: 1, b: 'y' })).toBe(false)
  })
})

describe('pgParams', () => {
  it('converts ? to $N starting from 1', () => {
    expect(pgParams('a = ? AND b = ?')).toBe('a = $1 AND b = $2')
  })

  it('respects offset', () => {
    expect(pgParams('a = ? AND b = ?', 3)).toBe('a = $3 AND b = $4')
  })

  it('handles no placeholders', () => {
    expect(pgParams('x IS NOT NULL')).toBe('x IS NOT NULL')
  })

  it('handles single placeholder', () => {
    expect(pgParams('x = ?', 5)).toBe('x = $5')
  })
})
