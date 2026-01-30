import type { DriverConfig, VectorDbProvider, VectorizeMatches } from '../types'

export interface PgvectorConfig extends DriverConfig {
  /** PostgreSQL connection URL */
  url: string
}

/**
 * Create a pgvector storage provider for PostgreSQL
 * Requires pgvector extension installed in PostgreSQL
 */
export default async function createPgvectorDriver(
  config: PgvectorConfig,
): Promise<VectorDbProvider> {
  const { url, dimensions } = config

  if (!url) {
    throw new Error('[pgvector] url (PostgreSQL connection string) is required')
  }

  if (!dimensions) {
    throw new Error('[pgvector] dimensions is required')
  }

  // Lazy import
  const postgres = (await import('postgres')).default

  // Create postgres connection
  const sql = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  })

  // Enable pgvector extension
  await sql`CREATE EXTENSION IF NOT EXISTS vector`

  // Create table with vector column
  await sql`
    CREATE TABLE IF NOT EXISTS vectors (
      id TEXT PRIMARY KEY,
      namespace TEXT,
      metadata JSONB,
      embedding vector(${sql(dimensions)})
    )
  `

  // Create indexes for performance
  await sql`
    CREATE INDEX IF NOT EXISTS idx_namespace ON vectors(namespace)
  `

  // Create vector similarity index (HNSW for cosine distance)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_embedding ON vectors
    USING hnsw (embedding vector_cosine_ops)
  `

  return {
    mode: 'vector' as const,
    dimensions,

    async query(queryVector, options = {}): Promise<VectorizeMatches> {
      const vector = Array.isArray(queryVector) ? queryVector : Array.from(queryVector)

      if (vector.length !== dimensions) {
        throw new Error(`Query vector dimension mismatch: expected ${dimensions}, got ${vector.length}`)
      }

      const {
        topK = 10,
        namespace,
        returnValues = false,
        returnMetadata = true,
      } = options

      const vectorStr = `[${vector.join(',')}]`

      // Build query with optional namespace filter
      // Use <=> for cosine distance (pgvector)
      let results
      if (namespace) {
        results = await sql`
          SELECT
            id,
            namespace,
            ${returnMetadata ? sql`metadata` : sql`NULL as metadata`},
            ${returnValues ? sql`embedding` : sql`NULL as embedding`},
            1 - (embedding <=> ${vectorStr}::vector) as score
          FROM vectors
          WHERE namespace = ${namespace}
          ORDER BY embedding <=> ${vectorStr}::vector
          LIMIT ${topK}
        `
      }
      else {
        results = await sql`
          SELECT
            id,
            namespace,
            ${returnMetadata ? sql`metadata` : sql`NULL as metadata`},
            ${returnValues ? sql`embedding` : sql`NULL as embedding`},
            1 - (embedding <=> ${vectorStr}::vector) as score
          FROM vectors
          ORDER BY embedding <=> ${vectorStr}::vector
          LIMIT ${topK}
        `
      }

      const matches = results.map((row: any) => {
        const match: any = {
          id: row.id,
          score: Math.max(0, Math.min(1, row.score)), // Clamp to 0-1 range
        }

        if (row.namespace) {
          match.namespace = row.namespace
        }

        if (returnMetadata && row.metadata) {
          match.metadata = row.metadata
        }

        if (returnValues && row.embedding) {
          match.values = row.embedding
        }

        return match
      })

      return {
        matches,
        count: matches.length,
      }
    },

    async insert(vectors): Promise<{ ids: string[], count: number }> {
      const ids: string[] = []

      for (const vec of vectors) {
        if (vec.values.length !== dimensions) {
          throw new Error(`Vector dimension mismatch: expected ${dimensions}, got ${vec.values.length}`)
        }

        const vectorStr = `[${(Array.isArray(vec.values) ? vec.values : Array.from(vec.values)).join(',')}]`

        // Check if ID exists
        const existing = await sql`SELECT 1 FROM vectors WHERE id = ${vec.id}`
        if (existing.length > 0) {
          throw new Error(`Vector with id ${vec.id} already exists`)
        }

        await sql`
          INSERT INTO vectors (id, namespace, metadata, embedding)
          VALUES (
            ${vec.id},
            ${vec.namespace || null},
            ${vec.metadata ? sql.json(vec.metadata) : null},
            ${vectorStr}::vector
          )
        `

        ids.push(vec.id)
      }

      return { ids, count: ids.length }
    },

    async upsert(vectors): Promise<{ ids: string[], count: number }> {
      const ids: string[] = []

      for (const vec of vectors) {
        if (vec.values.length !== dimensions) {
          throw new Error(`Vector dimension mismatch: expected ${dimensions}, got ${vec.values.length}`)
        }

        const vectorStr = `[${(Array.isArray(vec.values) ? vec.values : Array.from(vec.values)).join(',')}]`

        // Use ON CONFLICT for upsert
        await sql`
          INSERT INTO vectors (id, namespace, metadata, embedding)
          VALUES (
            ${vec.id},
            ${vec.namespace || null},
            ${vec.metadata ? sql.json(vec.metadata) : null},
            ${vectorStr}::vector
          )
          ON CONFLICT (id) DO UPDATE SET
            namespace = EXCLUDED.namespace,
            metadata = EXCLUDED.metadata,
            embedding = EXCLUDED.embedding
        `

        ids.push(vec.id)
      }

      return { ids, count: ids.length }
    },

    async close(): Promise<void> {
      await sql.end()
    },
  }
}

export { createPgvectorDriver }
