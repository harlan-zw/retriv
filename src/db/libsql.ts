import type { BaseDriverConfig, Document, EmbeddingConfig, SearchOptions, SearchProvider, SearchResult } from '../types'
import { createClient } from '@libsql/client'
import { resolveEmbedding } from '../embeddings/resolve'
import { compileFilter } from '../filter'
import { extractSnippet } from '../utils/extract-snippet'

export interface LibsqlConfig extends BaseDriverConfig {
  /** Database URL (file:path.db for local, libsql://... for remote) */
  url?: string
  /** Auth token for remote LibSQL/Turso */
  authToken?: string
  /** Embedding provider from retriv/embeddings/ */
  embeddings: EmbeddingConfig
}

/**
 * Create a LibSQL/Turso vector search provider
 * Supports local SQLite files and remote Turso databases
 *
 * @example
 * ```ts
 * import { libsql } from 'retriv/db/libsql'
 * import { openai } from 'retriv/embeddings/openai'
 *
 * const db = await libsql({
 *   url: 'libsql://your-db.turso.io',
 *   authToken: process.env.TURSO_AUTH_TOKEN,
 *   embeddings: openai({ model: 'text-embedding-3-small' }),
 * })
 * ```
 */
export async function libsql(config: LibsqlConfig): Promise<SearchProvider> {
  const url = config.url || config.path || 'file:vectors.db'
  const { authToken } = config

  if (!config.embeddings) {
    throw new Error('[libsql] embeddings is required')
  }

  // Resolve embedding provider and detect dimensions
  const { embedder, dimensions } = await resolveEmbedding(config.embeddings)

  const client = createClient({
    url,
    ...(authToken && { authToken }),
  })

  await client.execute(`
    CREATE TABLE IF NOT EXISTS vectors (
      id TEXT PRIMARY KEY,
      content TEXT,
      metadata TEXT,
      embedding F32_BLOB(${dimensions})
    )
  `)

  return {
    async index(docs: Document[]) {
      if (docs.length === 0)
        return { count: 0 }

      const texts = docs.map(d => d.content)
      const embeddings = await embedder(texts)

      if (embeddings.length !== docs.length) {
        throw new Error(`Embedding count mismatch: expected ${docs.length}, got ${embeddings.length}`)
      }

      for (let i = 0; i < docs.length; i++) {
        const doc = docs[i]!
        const vector = embeddings[i]!
        const vectorStr = JSON.stringify(vector)

        await client.execute({
          sql: `
            INSERT OR REPLACE INTO vectors (id, content, metadata, embedding)
            VALUES (?, ?, ?, vector(?))
          `,
          args: [
            doc.id,
            doc.content,
            doc.metadata ? JSON.stringify(doc.metadata) : null,
            vectorStr,
          ],
        })
      }

      return { count: docs.length }
    },

    async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
      const { limit = 10, returnContent = false, returnMetadata = true, filter } = options

      const [embedding] = await embedder([query])
      if (!embedding) {
        throw new Error('Failed to generate query embedding')
      }

      const vectorStr = JSON.stringify(embedding)
      const filterClause = filter ? compileFilter(filter, 'json') : { sql: '', params: [] }
      const whereClause = filterClause.sql ? `WHERE ${filterClause.sql}` : ''

      const results = await client.execute({
        sql: `
          SELECT
            id,
            content,
            metadata,
            vector_distance_cos(embedding, vector32(?)) as distance
          FROM vectors
          ${whereClause}
          ORDER BY distance
          LIMIT ?
        `,
        args: [vectorStr, ...filterClause.params, limit],
      })

      return (results.rows || []).map((row: any) => {
        const result: SearchResult = {
          id: row.id,
          score: Math.max(0, 1 - row.distance),
        }

        if (returnContent && row.content) {
          const { snippet, highlights } = extractSnippet(row.content, query)
          result.content = snippet
          if (highlights.length)
            result._meta = { ...result._meta, highlights }
        }

        if (returnMetadata && row.metadata) {
          result.metadata = JSON.parse(row.metadata)
        }

        return result
      })
    },

    async remove(ids: string[]) {
      for (const id of ids) {
        await client.execute({
          sql: 'DELETE FROM vectors WHERE id = ?',
          args: [id],
        })
      }
      return { count: ids.length }
    },

    async clear() {
      await client.execute('DELETE FROM vectors')
    },

    async close() {
      client.close()
    },
  }
}

export default libsql
