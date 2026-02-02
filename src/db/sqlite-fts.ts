import type { BaseDriverConfig, Document, SearchOptions, SearchProvider, SearchResult } from '../types'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
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
      metadata,
      tokenize='porter unicode61'
    )
  `)

  return {
    async index(docs: Document[]) {
      db.prepare('BEGIN').run()
      try {
        for (const doc of docs) {
          db.prepare('DELETE FROM documents_fts WHERE id = ?').run(doc.id)
          db.prepare('INSERT INTO documents_fts (id, content, metadata) VALUES (?, ?, ?)').run(
            doc.id,
            doc.content,
            doc.metadata ? JSON.stringify(doc.metadata) : null,
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
      const { limit = 10, returnContent = false, returnMetadata = true } = options

      // Escape FTS5 special characters: " ( ) * : ^ -
      // and remove ? which isn't valid in FTS5 queries
      const sanitized = query
        .replace(/[?"():^*-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

      if (!sanitized)
        return []

      // Use BM25 ranking (built into FTS5)
      const stmt = db.prepare(`
        SELECT
          id,
          ${returnContent ? 'content,' : ''}
          ${returnMetadata ? 'metadata,' : ''}
          bm25(documents_fts) as score
        FROM documents_fts
        WHERE documents_fts MATCH ?
        ORDER BY bm25(documents_fts)
        LIMIT ?
      `)

      const rows = stmt.all(sanitized, limit) as any[]

      return rows.map((row) => {
        // BM25 returns negative values, lower is better
        // Convert to 0-1 score where higher is better
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

        if (returnMetadata && row.metadata) {
          result.metadata = JSON.parse(row.metadata)
        }

        return result
      })
    },

    async remove(ids: string[]) {
      db.prepare('BEGIN').run()
      try {
        for (const id of ids) {
          db.prepare('DELETE FROM documents_fts WHERE id = ?').run(id)
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
    },

    async close() {
      db.close?.()
    },
  }
}

export default sqliteFts
