import type { BaseDriverConfig, Document, EmbeddingConfig, IndexOptions, SearchOptions, SearchProvider, SearchResult } from '../types'
import pg from 'pg'
import { resolveEmbedding } from '../embeddings/resolve'
import { compileFilter, pgParams } from '../filter'
import { extractSnippet } from '../utils/extract-snippet'

export interface PgvectorConfig extends BaseDriverConfig {
  /** PostgreSQL connection URL */
  url: string
  /** Table name for vectors */
  table?: string
  /** Embedding provider from retriv/embeddings/ */
  embeddings: EmbeddingConfig
  /** Distance metric */
  metric?: 'cosine' | 'euclidean' | 'inner_product'
}

/**
 * Create a PostgreSQL pgvector search provider
 *
 * @example
 * ```ts
 * import { pgvector } from 'retriv/db/pgvector'
 * import { openai } from 'retriv/embeddings/openai'
 *
 * const db = await pgvector({
 *   url: process.env.DATABASE_URL,
 *   embeddings: openai({ model: 'text-embedding-3-small' }),
 * })
 * ```
 */
export async function pgvector(config: PgvectorConfig): Promise<SearchProvider> {
  const { url, table = 'vectors', metric = 'cosine' } = config

  if (!url) {
    throw new Error('[pgvector] url is required')
  }

  if (!config.embeddings) {
    throw new Error('[pgvector] embeddings is required')
  }

  // Resolve embedding provider and detect dimensions
  const { embedder, dimensions } = await resolveEmbedding(config.embeddings)

  const pool = new pg.Pool({ connectionString: url })

  // Ensure pgvector extension and table exist
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${table} (
      id TEXT PRIMARY KEY,
      content TEXT,
      metadata JSONB,
      embedding vector(${dimensions})
    )
  `)

  // Create index for fast similarity search
  const indexName = `${table}_embedding_idx`
  const opClass = metric === 'cosine' ? 'vector_cosine_ops' : metric === 'euclidean' ? 'vector_l2_ops' : 'vector_ip_ops'
  await pool.query(`
    CREATE INDEX IF NOT EXISTS ${indexName}
    ON ${table} USING ivfflat (embedding ${opClass})
    WITH (lists = 100)
  `).catch(() => {
    // Index might fail if not enough rows, that's ok
  })

  const distanceOp = metric === 'cosine' ? '<=>' : metric === 'euclidean' ? '<->' : '<#>'

  return {
    async index(docs: Document[], options?: IndexOptions) {
      if (docs.length === 0)
        return { count: 0 }

      const onProgress = options?.onProgress
      onProgress?.({ phase: 'embedding', current: 0, total: docs.length })
      const texts = docs.map(d => d.content)
      const embeddings = await embedder(texts)
      onProgress?.({ phase: 'embedding', current: docs.length, total: docs.length })

      if (embeddings.length !== docs.length) {
        throw new Error(`Embedding count mismatch: expected ${docs.length}, got ${embeddings.length}`)
      }

      for (let i = 0; i < docs.length; i++) {
        const doc = docs[i]!
        const vector = embeddings[i]!
        const vectorStr = `[${vector.join(',')}]`

        await pool.query(
          `INSERT INTO ${table} (id, content, metadata, embedding)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET
             content = EXCLUDED.content,
             metadata = EXCLUDED.metadata,
             embedding = EXCLUDED.embedding`,
          [doc.id, doc.content, doc.metadata || null, vectorStr],
        )

        onProgress?.({ phase: 'storing', current: i + 1, total: docs.length })
      }

      return { count: docs.length }
    },

    async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
      const { limit = 10, returnContent = false, returnMetadata = true, filter } = options

      const [embedding] = await embedder([query])
      if (!embedding) {
        throw new Error('Failed to generate query embedding')
      }

      const vectorStr = `[${embedding.join(',')}]`

      const filterClause = filter ? compileFilter(filter, 'jsonb') : { sql: '', params: [] }
      const pgFilterSql = filterClause.sql ? pgParams(filterClause.sql, 2) : ''
      const whereClause = pgFilterSql ? `WHERE ${pgFilterSql}` : ''
      const limitParam = `$${filterClause.params.length + 2}`

      const result = await pool.query(
        `SELECT id, content, metadata, embedding ${distanceOp} $1::vector as distance
         FROM ${table}
         ${whereClause}
         ORDER BY embedding ${distanceOp} $1::vector
         LIMIT ${limitParam}`,
        [vectorStr, ...filterClause.params, limit],
      )

      return result.rows.map((row: any) => {
        // Convert distance to similarity score (0-1, higher is better)
        const score = metric === 'inner_product'
          ? Math.max(0, Math.min(1, (row.distance + 1) / 2)) // inner product: -1 to 1 -> 0 to 1
          : Math.max(0, 1 - row.distance) // cosine/euclidean: 0 to 2 -> 1 to -1, clamped

        const searchResult: SearchResult = {
          id: row.id,
          score,
        }

        if (returnContent && row.content) {
          const { snippet, highlights } = extractSnippet(row.content, query)
          searchResult.content = snippet
          if (highlights.length)
            searchResult._meta = { ...searchResult._meta, highlights }
        }

        if (returnMetadata && row.metadata) {
          searchResult.metadata = row.metadata
        }

        return searchResult
      })
    },

    async remove(ids: string[]) {
      await pool.query(
        `DELETE FROM ${table} WHERE id = ANY($1)`,
        [ids],
      )
      return { count: ids.length }
    },

    async clear() {
      await pool.query(`DELETE FROM ${table}`)
    },

    async close() {
      await pool.end()
    },
  }
}

export default pgvector
