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

const activeDrivers = drivers.filter(d => !d.skip)

// Shared state - seeded once, reused across all tests
let docs: Document[]
const driverInstances = new Map<string, SearchProvider>()

beforeAll(async () => {
  // Load docs - use subset for faster tests while still covering all topics
  // Full 2817 docs would require ~6000 embedding calls across drivers
  const allDocs = await loadNuxtDocs()
  docs = allDocs.slice(0, 500)

  // Create and seed all driver instances in parallel
  await Promise.all(
    activeDrivers.map(async ({ name, factory }) => {
      const db = await factory()
      await db.index(docs)
      driverInstances.set(name, db)
    }),
  )
}, 300_000)

afterAll(async () => {
  await Promise.all(
    Array.from(driverInstances.values()).map(db => db.close?.()),
  )
})

// Per-driver search tests
describe.each(activeDrivers)('$name', ({ name }) => {
  it('returns results for valid query', async () => {
    const db = driverInstances.get(name)!
    const results = await db.search('composables', { limit: 5 })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]!.score).toBeGreaterThan(0)
    expect(results[0]!.score).toBeLessThanOrEqual(1)
  })

  it('respects limit option', async () => {
    const db = driverInstances.get(name)!
    const results = await db.search('nuxt', { limit: 3 })
    expect(results.length).toBeLessThanOrEqual(3)
  })

  it('returns content when requested', async () => {
    const db = driverInstances.get(name)!
    const results = await db.search('router', { limit: 1, returnContent: true })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]!.content).toBeDefined()
    expect(typeof results[0]!.content).toBe('string')
  })
})

// Snapshot tests
describe('snapshots', () => {
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

// Comparative test
describe('comparative', () => {
  it('drivers return overlapping results for same query', async () => {
    const query = 'components'
    const limit = 5

    const allResults = await Promise.all(
      Array.from(driverInstances.entries()).map(async ([name, db]) => {
        const results = await db.search(query, { limit })
        return { name, ids: results.map(r => r.id) }
      }),
    )

    // Check pairwise overlap
    for (let i = 0; i < allResults.length; i++) {
      for (let j = i + 1; j < allResults.length; j++) {
        const a = allResults[i]!
        const b = allResults[j]!
        const overlap = a.ids.filter(id => b.ids.includes(id))

        if (overlap.length === 0) {
          console.warn(`No overlap between ${a.name} and ${b.name}`)
          console.warn(`  ${a.name}: ${a.ids.join(', ')}`)
          console.warn(`  ${b.name}: ${b.ids.join(', ')}`)
        }
      }
    }

    for (const { name, ids } of allResults) {
      expect(ids.length, `${name} should return results`).toBeGreaterThan(0)
    }
  })
})

// Destructive tests - run last, use fresh instances
describe('mutations', () => {
  it.each(activeDrivers)('$name: remove deletes documents', async ({ _name, factory }) => {
    const db = await factory()
    const subset = docs.slice(0, 10)
    await db.index(subset)

    const targetDoc = subset[0]!
    await db.remove?.([targetDoc.id])

    const results = await db.search('introduction', { limit: 20 })
    expect(results.find(r => r.id === targetDoc.id)).toBeUndefined()

    await db.close?.()
  }, 60_000)

  it.each(activeDrivers)('$name: clear removes all', async ({ _name, factory }) => {
    const db = await factory()
    const subset = docs.slice(0, 10)
    await db.index(subset)

    await db.clear?.()

    const results = await db.search('nuxt', { limit: 10 })
    expect(results).toHaveLength(0)

    await db.close?.()
  }, 60_000)
})
