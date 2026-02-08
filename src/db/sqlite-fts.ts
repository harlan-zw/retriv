import type { BaseDriverConfig, Document, IndexOptions, SearchOptions, SearchProvider, SearchResult } from '../types'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { compileFilter } from '../filter'
import { extractSnippet } from '../utils/extract-snippet'

/**
 * Sanitize a query string for FTS5 — strip special chars, return tokens.
 */
export function sanitizeFtsTokens(query: string): string[] {
  return query
    .replace(/[?"():^*\-=<>[\]{}/\\|@#$%&~`+,.;!]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0)
}

/**
 * Build an FTS5 MATCH expression from tokens.
 * mode='and' = implicit AND (FTS5 default), mode='or' = explicit OR.
 */
export function buildFtsQuery(tokens: string[], mode: 'and' | 'or' = 'and'): string {
  if (tokens.length === 0)
    return ''
  if (tokens.length === 1)
    return tokens[0]!
  return mode === 'or' ? tokens.join(' OR ') : tokens.join(' ')
}

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
    async index(docs: Document[], options?: IndexOptions) {
      const onProgress = options?.onProgress
      db.prepare('BEGIN').run()
      try {
        for (let i = 0; i < docs.length; i++) {
          const doc = docs[i]!
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

          onProgress?.({ phase: 'storing', current: i + 1, total: docs.length })
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

      const tokens = sanitizeFtsTokens(query)
      const andQuery = buildFtsQuery(tokens, 'and')
      const orQuery = buildFtsQuery(tokens, 'or')
      if (!andQuery && !orQuery)
        return []

      const filterClause = compileFilter(filter, 'json', 'meta')
      const filterWhere = filterClause.sql ? `AND ${filterClause.sql}` : ''
      const fetchLimit = limit * 2

      const stmt = db.prepare(`
        SELECT fts.id, meta.content, meta.metadata, bm25(documents_fts) as score
        FROM documents_fts fts
        INNER JOIN documents_meta meta ON fts.id = meta.id
        WHERE documents_fts MATCH ?
        ${filterWhere}
        ORDER BY bm25(documents_fts)
        LIMIT ?
      `)

      interface FtsRow { id: string, content: string | null, metadata: string | null, score: number }
      const mapRows = (rows: FtsRow[]): SearchResult[] => rows.map((row) => {
        const result: SearchResult = {
          id: row.id,
          score: Math.max(0, Math.min(1, 1 / (1 + Math.abs(row.score)))),
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

      const andResults = andQuery
        ? mapRows(stmt.all(andQuery, ...filterClause.params, fetchLimit) as unknown as FtsRow[])
        : []

      // Single token — AND and OR are identical, skip duplicate query
      if (!orQuery || orQuery === andQuery)
        return andResults.slice(0, limit)

      const orResults = mapRows(stmt.all(orQuery, ...filterClause.params, fetchLimit) as unknown as FtsRow[])

      // Mini RRF fusion of AND (precision) + OR (recall, downweighted)
      const OR_WEIGHT = 0.5
      const scores = new Map<string, { score: number, result: SearchResult }>()
      for (const [results, weight] of [[andResults, 1], [orResults, OR_WEIGHT]] as const) {
        for (let rank = 0; rank < results.length; rank++) {
          const r = results[rank]!
          const rrfScore = weight / (60 + rank + 1)
          const existing = scores.get(r.id)
          if (existing) {
            existing.score += rrfScore
            if (r.content && !existing.result.content)
              existing.result = { ...existing.result, content: r.content }
          }
          else {
            scores.set(r.id, { score: rrfScore, result: r })
          }
        }
      }

      return Array.from(scores.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ score, result }) => ({ ...result, score }))
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
