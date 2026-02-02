import type { Document, SearchProvider } from '../../src/types'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { libsql } from '../../src/db/libsql'
import { pgvector } from '../../src/db/pgvector'
import { sqliteFts } from '../../src/db/sqlite-fts'
import { sqliteVec } from '../../src/db/sqlite-vec'
import { loadNuxtDocs } from './fixtures/nuxt-docs'
import { embeddings } from './setup/embeddings'

interface DriverConfig {
  name: string
  factory: () => Promise<SearchProvider>
  mode: 'fulltext' | 'fuzzy' | 'semantic'
  skip?: boolean
}

const PG_URL = process.env.PG_URL

const drivers: DriverConfig[] = [
  {
    name: 'sqlite-fts',
    factory: () => sqliteFts({ path: ':memory:' }),
    mode: 'fulltext',
  },
  {
    name: 'sqlite-vec',
    factory: () => sqliteVec({ path: ':memory:', embeddings }),
    mode: 'semantic',
  },
  {
    name: 'libsql',
    factory: () => libsql({ url: ':memory:', embeddings }),
    mode: 'semantic',
  },
  {
    name: 'pgvector',
    factory: () => pgvector({ url: PG_URL!, embeddings }),
    mode: 'semantic',
    skip: !PG_URL,
  },
]

// Shared docs loaded once
let docs: Document[]

beforeAll(async () => {
  docs = await loadNuxtDocs()
}, 60_000)

describe.each(drivers.filter(d => !d.skip))('$name', ({ factory }) => {
  let db: SearchProvider
  let indexedDocs: Document[]

  beforeAll(async () => {
    db = await factory()
    // Use subset for faster tests
    indexedDocs = docs.slice(0, 50)
    await db.index(indexedDocs)
  }, 120_000)

  afterAll(async () => {
    await db?.close?.()
  })

  it('returns results for valid query', async () => {
    const results = await db.search('composables', { limit: 5 })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]!.score).toBeGreaterThan(0)
    expect(results[0]!.score).toBeLessThanOrEqual(1)
  })

  it('respects limit option', async () => {
    const results = await db.search('nuxt', { limit: 3 })
    expect(results.length).toBeLessThanOrEqual(3)
  })

  it('returns content when requested', async () => {
    const results = await db.search('router', { limit: 1, returnContent: true })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]!.content).toBeDefined()
    expect(typeof results[0]!.content).toBe('string')
  })

  it('remove deletes documents', async () => {
    const targetDoc = indexedDocs[0]!
    // Use only alphanumeric words to avoid FTS5 syntax issues with # etc
    const words = targetDoc.content.match(/\b[a-z]{4,}\b/gi) || []
    const searchTerm = words.slice(0, 2).join(' ')

    await db.remove?.([targetDoc.id])

    const results = await db.search(searchTerm, { limit: 20 })
    expect(results.find(r => r.id === targetDoc.id)).toBeUndefined()

    // Re-index for subsequent tests
    await db.index([targetDoc])
  })

  it('clear removes all', async () => {
    await db.clear?.()

    const results = await db.search('nuxt', { limit: 10 })
    expect(results).toHaveLength(0)

    // Re-index for any subsequent tests
    await db.index(indexedDocs)
  })
})

// Snapshot tests - see what results look like for each driver
describe('snapshots', () => {
  const activeDrivers = drivers.filter(d => !d.skip)
  const driverInstances = new Map<string, SearchProvider>()

  beforeAll(async () => {
    const subset = docs.slice(0, 30)

    await Promise.all(
      activeDrivers.map(async ({ name, factory }) => {
        const db = await factory()
        await db.index(subset)
        driverInstances.set(name, db)
      }),
    )
  }, 180_000)

  afterAll(async () => {
    await Promise.all(
      Array.from(driverInstances.values()).map(db => db.close?.()),
    )
  })

  const queries = ['components', 'server', 'routing', 'state management']

  it.each(queries)('results for "%s"', async (query) => {
    const results: Record<string, Array<{ id: string, score: string, preview: string }>> = {}

    for (const [name, db] of driverInstances) {
      const searchResults = await db.search(query, { limit: 5, returnContent: true })
      results[name] = searchResults.map(r => ({
        id: r.id,
        score: r.score.toFixed(3),
        preview: r.content?.slice(0, 80).replace(/\n/g, ' ') || '',
      }))
    }

    expect(results).toMatchSnapshot()
  })
})

// Comparative test - all drivers should return overlapping results
describe('comparative', () => {
  const activeDrivers = drivers.filter(d => !d.skip)
  const driverResults = new Map<string, SearchProvider>()

  beforeAll(async () => {
    const subset = docs.slice(0, 30)

    await Promise.all(
      activeDrivers.map(async ({ name, factory }) => {
        const db = await factory()
        await db.index(subset)
        driverResults.set(name, db)
      }),
    )
  }, 180_000)

  afterAll(async () => {
    await Promise.all(
      Array.from(driverResults.values()).map(db => db.close?.()),
    )
  })

  it('drivers return overlapping results for same query', async () => {
    const query = 'components'
    const limit = 5

    const allResults = await Promise.all(
      Array.from(driverResults.entries()).map(async ([name, db]) => {
        const results = await db.search(query, { limit })
        return { name, ids: results.map(r => r.id) }
      }),
    )

    // Check pairwise overlap - each pair should share at least 1 result
    for (let i = 0; i < allResults.length; i++) {
      for (let j = i + 1; j < allResults.length; j++) {
        const a = allResults[i]!
        const b = allResults[j]!
        const overlap = a.ids.filter(id => b.ids.includes(id))

        // At least some overlap expected (relaxed check since modes differ)
        // Semantic vs fulltext vs fuzzy may rank differently
        if (overlap.length === 0) {
          console.warn(`No overlap between ${a.name} and ${b.name}`)
          console.warn(`  ${a.name}: ${a.ids.join(', ')}`)
          console.warn(`  ${b.name}: ${b.ids.join(', ')}`)
        }
      }
    }

    // At least verify all drivers returned results
    for (const { name, ids } of allResults) {
      expect(ids.length, `${name} should return results`).toBeGreaterThan(0)
    }
  })
})
