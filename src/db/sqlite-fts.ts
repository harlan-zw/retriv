import type { BaseDriverConfig, Document, SearchOptions, SearchProvider, SearchResult } from '../types'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { compileFilter } from '../filter'
import { extractSnippet } from '../utils/extract-snippet'

export interface SqliteFtsConfig extends BaseDriverConfig {
  /** Path to SQLite database file. Use ':memory:' for in-memory. */
  path?: string
}

/**
 * Create a SQLite FTS5 full-text search provider
 * Uses the built-in FTS5 extension for fast BM25-based search
 * Requires Node.js >= 22.5
 *
 * @example
 * ```ts
 * import { sqliteFts } from 'retriv/db/sqlite-fts'
 *
 * const db = await sqliteFts({
 *   path: 'search.db',
 * })
 * ```
 */
export async function sqliteFts(config: SqliteFtsConfig = {}): Promise<SearchProvider> {
  const dbPath = config.path || ':memory:'

  const nodeSqlite = globalThis.process?.getBuiltinModule?.('node:sqlite') as typeof import('node:sqlite') | undefined
  if (!nodeSqlite)
    throw new Error('node:sqlite not available. Requires Node.js >= 22.5')

  if (dbPath !== ':memory:')
    mkdirSync(dirname(dbPath), { recursive: true })

  const db = new nodeSqlite.DatabaseSync(dbPath)

  // Create FTS5 virtual table with content storage
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      id,
      content,
      tokenize='porter unicode61'
    )
  `)

  // Metadata table for filtering (json_extract works on regular tables)
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents_meta (
      id TEXT PRIMARY KEY,
      content TEXT,
      metadata TEXT
    )
  `)

  return {
    async index(docs: Document[]) {
      db.prepare('BEGIN').run()
      try {
        for (const doc of docs) {
          const metadataJson = doc.metadata ? JSON.stringify(doc.metadata) : null

          // FTS5: upsert
          db.prepare('DELETE FROM documents_fts WHERE id = ?').run(doc.id)
          db.prepare('INSERT INTO documents_fts (id, content) VALUES (?, ?)').run(
            doc.id,
            doc.content,
          )

          // Metadata: upsert
          db.prepare('INSERT OR REPLACE INTO documents_meta (id, content, metadata) VALUES (?, ?, ?)').run(
            doc.id,
            doc.content,
            metadataJson,
          )
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

      // Escape FTS5 special characters: " ( ) * : ^ -
      // and remove ? which isn't valid in FTS5 queries
      const sanitized = query
        .replace(/[?"():^*-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

      if (!sanitized)
        return []

      const filterClause = compileFilter(filter, 'json', 'meta')
      const filterWhere = filterClause.sql ? `AND ${filterClause.sql}` : ''

      const rows = db.prepare(`
        SELECT fts.id, meta.content, meta.metadata, bm25(documents_fts) as score
        FROM documents_fts fts
        INNER JOIN documents_meta meta ON fts.id = meta.id
        WHERE documents_fts MATCH ?
        ${filterWhere}
        ORDER BY bm25(documents_fts)
        LIMIT ?
      `).all(sanitized, ...filterClause.params, limit) as Array<{
        id: string
        content: string | null
        metadata: string | null
        score: number
      }>

      return rows.map((row) => {
        const normalizedScore = Math.max(0, Math.min(1, 1 / (1 + Math.abs(row.score))))

        const result: SearchResult = {
          id: row.id,
          score: normalizedScore,
        }

        if (returnContent && row.content) {
          const { snippet, highlights } = extractSnippet(row.content, query)
          result.content = snippet
          if (highlights.length)
            result._meta = { ...result._meta, highlights }
        }

        if (returnMetadata && row.metadata)
          result.metadata = JSON.parse(row.metadata)

        return result
      })
    },

    async remove(ids: string[]) {
      db.prepare('BEGIN').run()
      try {
        for (const id of ids) {
          db.prepare('DELETE FROM documents_fts WHERE id = ?').run(id)
          db.prepare('DELETE FROM documents_meta WHERE id = ?').run(id)
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
      db.exec('DELETE FROM documents_fts')
      db.exec('DELETE FROM documents_meta')
    },

    async close() {
      db.close?.()
    },
  }
}

export default sqliteFts
