import type { DriverConfig, VectorDbProvider, VectorizeMatches } from '../types'

export interface LibsqlConfig extends DriverConfig {
  /** Database URL (file:path.db for local, libsql://... for remote) */
  url?: string
  /** Auth token for remote LibSQL/Turso */
  authToken?: string
}

/**
 * Create a LibSQL/Turso storage provider
 * Supports local SQLite files and remote Turso databases
 */
export default async function createLibsqlDriver(
  config: LibsqlConfig,
): Promise<VectorDbProvider> {
  const url = config.url || config.path || 'file:vectors.db'
  const { authToken, dimensions } = config

  if (!dimensions) {
    throw new Error('[libsql] dimensions is required')
  }

  // Lazy import
  const { createClient } = await import('@libsql/client')

  const client = createClient({
    url,
    ...(authToken && { authToken }),
  })

  // Create table with native F32_BLOB vector type
  await client.execute(`
    CREATE TABLE IF NOT EXISTS vectors (
      id TEXT PRIMARY KEY,
      namespace TEXT,
      metadata TEXT,
      embedding F32_BLOB(${dimensions})
    )
  `)

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

      const vectorStr = JSON.stringify(vector)

      let sql: string
      const args: any[] = []

      if (namespace) {
        sql = `
          SELECT
            id,
            namespace,
            ${returnMetadata ? 'metadata' : 'NULL as metadata'},
            ${returnValues ? 'embedding' : 'NULL as embedding'},
            vector_distance_cos(embedding, vector32(?)) as distance
          FROM vectors
          WHERE namespace = ?
          ORDER BY distance
          LIMIT ?
        `
        args.push(vectorStr, namespace, topK)
      }
      else {
        sql = `
          SELECT
            id,
            namespace,
            ${returnMetadata ? 'metadata' : 'NULL as metadata'},
            ${returnValues ? 'embedding' : 'NULL as embedding'},
            vector_distance_cos(embedding, vector32(?)) as distance
          FROM vectors
          ORDER BY distance
          LIMIT ?
        `
        args.push(vectorStr, topK)
      }

      const results = await client.execute({ sql, args })

      const matches = (results.rows || []).map((row: any) => {
        const match: any = {
          id: row.id,
          score: Math.max(0, 1 - row.distance), // Convert distance to similarity score
        }

        if (row.namespace) {
          match.namespace = row.namespace
        }

        if (returnMetadata && row.metadata) {
          match.metadata = JSON.parse(row.metadata)
        }

        if (returnValues && row.embedding) {
          match.values = JSON.parse(row.embedding)
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

        const vectorStr = JSON.stringify(Array.isArray(vec.values) ? vec.values : Array.from(vec.values))

        // Check if ID exists
        const existing = await client.execute({
          sql: 'SELECT 1 FROM vectors WHERE id = ?',
          args: [vec.id],
        })
        if (existing.rows && existing.rows.length > 0) {
          throw new Error(`Vector with id ${vec.id} already exists`)
        }

        await client.execute({
          sql: `
            INSERT INTO vectors (id, namespace, metadata, embedding)
            VALUES (?, ?, ?, vector(?))
          `,
          args: [
            vec.id,
            vec.namespace || null,
            vec.metadata ? JSON.stringify(vec.metadata) : null,
            vectorStr,
          ],
        })

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

        const vectorStr = JSON.stringify(Array.isArray(vec.values) ? vec.values : Array.from(vec.values))

        // Use INSERT OR REPLACE for upsert
        await client.execute({
          sql: `
            INSERT OR REPLACE INTO vectors (id, namespace, metadata, embedding)
            VALUES (?, ?, ?, vector(?))
          `,
          args: [
            vec.id,
            vec.namespace || null,
            vec.metadata ? JSON.stringify(vec.metadata) : null,
            vectorStr,
          ],
        })

        ids.push(vec.id)
      }

      return { ids, count: ids.length }
    },

    async close(): Promise<void> {
      client.close()
    },
  }
}

export { createLibsqlDriver }
