import type { BaseDriverConfig, Document, EmbeddingConfig, SearchOptions, SearchProvider, SearchResult } from '../types'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import * as sqliteVecExt from 'sqlite-vec'
import { resolveEmbedding } from '../embeddings/resolve'
import { matchesFilter } from '../filter'
import { extractSnippet } from '../utils/extract-snippet'

export interface SqliteVecConfig extends BaseDriverConfig {
  /** Path to SQLite database file. Use ':memory:' for in-memory. */
  path?: string
  /** Embedding provider from retriv/embeddings/ */
  embeddings: EmbeddingConfig
}

/**
 * Create a sqlite-vec vector search provider
 * Requires Node.js >= 22.5
 *
 * @example
 * ```ts
 * import { sqliteVec } from 'retriv/db/sqlite-vec'
 * import { openai } from 'retriv/embeddings/openai'
 *
 * const db = await sqliteVec({
 *   path: 'vectors.db',
 *   embeddings: openai({ model: 'text-embedding-3-small' }),
 * })
 * ```
 */
export async function sqliteVec(config: SqliteVecConfig): Promise<SearchProvider> {
  const dbPath = config.path || ':memory:'

  if (!config.embeddings) {
    throw new Error('[sqlite-vec] embeddings is required')
  }

  // Resolve embedding provider and detect dimensions
  const { embedder, dimensions } = await resolveEmbedding(config.embeddings)

  const nodeSqlite = globalThis.process?.getBuiltinModule?.('node:sqlite') as typeof import('node:sqlite') | undefined
  if (!nodeSqlite) {
    throw new Error('node:sqlite not available. Requires Node.js >= 22.5')
  }

  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true })
  }

  const db = new nodeSqlite.DatabaseSync(dbPath, {
    allowExtension: true,
    open: true,
    readOnly: false,
  })

  sqliteVecExt.load(db)
  db.exec('PRAGMA foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS vector_metadata (
      id TEXT PRIMARY KEY,
      content TEXT,
      metadata TEXT
    )
  `)

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vectors
    USING vec0(embedding float[${dimensions}])
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

      db.prepare('BEGIN').run()

      try {
        for (let i = 0; i < docs.length; i++) {
          const doc = docs[i]!
          const vector = embeddings[i]!

          if (vector.length !== dimensions) {
            throw new Error(`Vector dimension mismatch: expected ${dimensions}, got ${vector.length}`)
          }

          const embedding = new Float32Array(vector)

          // Check if exists
          const existing = db.prepare('SELECT rowid FROM vector_metadata WHERE id = ?').get(doc.id) as { rowid: bigint } | undefined

          if (existing) {
            db.prepare('UPDATE vectors SET embedding = ? WHERE rowid = ?').run(embedding, existing.rowid)
            db.prepare('UPDATE vector_metadata SET content = ?, metadata = ? WHERE rowid = ?').run(
              doc.content,
              doc.metadata ? JSON.stringify(doc.metadata) : null,
              existing.rowid,
            )
          }
          else {
            const result = db.prepare('INSERT INTO vectors (embedding) VALUES (?)').run(embedding)
            const rowid = result.lastInsertRowid
            db.prepare('INSERT INTO vector_metadata (rowid, id, content, metadata) VALUES (?, ?, ?, ?)').run(
              rowid,
              doc.id,
              doc.content,
              doc.metadata ? JSON.stringify(doc.metadata) : null,
            )
          }
        }

        db.prepare('COMMIT').run()
        return { count: docs.length }
      }
      catch (error) {
        db.prepare('ROLLBACK').run()
        throw error
      }
    },

    async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
      const { limit = 10, returnContent = false, returnMetadata = true, filter } = options

      const [embedding] = await embedder([query])
      if (!embedding) {
        throw new Error('Failed to generate query embedding')
      }

      const queryEmbedding = new Float32Array(embedding)
      const fetchLimit = filter ? limit * 4 : limit

      const vecResults = db.prepare(`
        SELECT rowid, distance
        FROM vectors
        WHERE embedding MATCH ?
        ORDER BY distance
        LIMIT ?
      `).all(queryEmbedding, fetchLimit) as Array<{ rowid: bigint, distance: number }>

      const mapped = vecResults.map((row) => {
        const meta = db.prepare('SELECT id, content, metadata FROM vector_metadata WHERE rowid = ?')
          .get(row.rowid) as { id: string, content: string | null, metadata: string | null } | undefined

        if (!meta)
          return null

        const parsed = meta.metadata ? JSON.parse(meta.metadata) : undefined

        if (filter && !matchesFilter(filter, parsed))
          return null

        const result: SearchResult = {
          id: meta.id,
          score: 1 / (1 + row.distance),
        }

        if (returnContent && meta.content) {
          const { snippet, highlights } = extractSnippet(meta.content, query)
          result.content = snippet
          if (highlights.length)
            result._meta = { ...result._meta, highlights }
        }

        if (returnMetadata && parsed) {
          result.metadata = parsed
        }

        return result
      }).filter(Boolean) as SearchResult[]

      return mapped.slice(0, limit)
    },

    async remove(ids: string[]) {
      db.prepare('BEGIN').run()

      try {
        for (const id of ids) {
          const meta = db.prepare('SELECT rowid FROM vector_metadata WHERE id = ?').get(id) as { rowid: bigint } | undefined
          if (meta) {
            db.prepare('DELETE FROM vectors WHERE rowid = ?').run(meta.rowid)
            db.prepare('DELETE FROM vector_metadata WHERE rowid = ?').run(meta.rowid)
          }
        }

        db.prepare('COMMIT').run()
        return { count: ids.length }
      }
      catch (error) {
        db.prepare('ROLLBACK').run()
        throw error
      }
    },

    async clear() {
      db.exec('DELETE FROM vectors')
      db.exec('DELETE FROM vector_metadata')
    },

    async close() {
      db.close?.()
    },
  }
}

export default sqliteVec
