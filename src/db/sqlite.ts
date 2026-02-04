import type { Document, EmbeddingConfig, SearchOptions, SearchProvider, SearchResult } from '../types'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import * as sqliteVecExt from 'sqlite-vec'
import { resolveEmbedding } from '../embeddings/resolve'
import { compileFilter } from '../filter'
import { extractSnippet } from '../utils/extract-snippet'
import { buildFtsQuery, sanitizeFtsTokens } from './sqlite-fts'

const RRF_K = 60

/**
 * Extract markdown headers from content
 * Returns newline-joined header text (without # prefixes)
 */
function extractHeaders(content: string): string {
  // Strip fenced code blocks to avoid false positives
  const withoutCodeBlocks = content.replace(/```[\s\S]*?```/g, '')
  return withoutCodeBlocks
    .split('\n')
    .filter(line => /^#{1,6}\s/.test(line))
    .map(line => line.replace(/^#{1,6}\s+/, ''))
    .join('\n')
}

export interface SqliteConfig {
  /** Path to SQLite database file. Use ':memory:' for in-memory. */
  path?: string
  /** Embedding provider from retriv/embeddings/ */
  embeddings: EmbeddingConfig
}

/**
 * Apply Reciprocal Rank Fusion to merge results
 */
interface WeightedResultSet {
  results: SearchResult[]
  weight?: number
}

function applyRRF(sets: (SearchResult[] | WeightedResultSet)[]): SearchResult[] {
  const scores = new Map<string, { score: number, result: SearchResult }>()

  for (const set of sets) {
    const results = Array.isArray(set) ? set : set.results
    const weight = Array.isArray(set) ? 1 : (set.weight ?? 1)

    for (let rank = 0; rank < results.length; rank++) {
      const result = results[rank]!
      const rrfScore = weight / (RRF_K + rank + 1)
      const existing = scores.get(result.id)

      if (existing) {
        existing.score += rrfScore
        if (result.content && !existing.result.content)
          existing.result = { ...existing.result, content: result.content }
        if (result.metadata && !existing.result.metadata)
          existing.result = { ...existing.result, metadata: result.metadata }
      }
      else {
        scores.set(result.id, { score: rrfScore, result })
      }
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map(({ score, result }) => ({ ...result, score }))
}

/**
 * Create a unified SQLite hybrid search provider
 * Combines FTS5 (BM25) + sqlite-vec (vector) with RRF fusion
 * Requires Node.js >= 22.5
 *
 * @example
 * ```ts
 * import { sqlite } from 'retriv/db/sqlite'
 * import { transformersJs } from 'retriv/embeddings/transformers-js'
 *
 * const db = await sqlite({
 *   path: 'search.db',
 *   embeddings: transformersJs({ model: 'Xenova/all-MiniLM-L6-v2', dimensions: 384 }),
 * })
 *
 * await db.index([{ id: '1', content: 'hello world' }])
 * const results = await db.search('hello') // hybrid: BM25 + semantic
 * ```
 */
export async function sqlite(config: SqliteConfig): Promise<SearchProvider> {
  const dbPath = config.path || ':memory:'

  if (!config.embeddings)
    throw new Error('[sqlite] embeddings is required')

  const { embedder, dimensions } = await resolveEmbedding(config.embeddings)

  const nodeSqlite = globalThis.process?.getBuiltinModule?.('node:sqlite') as typeof import('node:sqlite') | undefined
  if (!nodeSqlite)
    throw new Error('node:sqlite not available. Requires Node.js >= 22.5')

  if (dbPath !== ':memory:')
    mkdirSync(dirname(dbPath), { recursive: true })

  const db = new nodeSqlite.DatabaseSync(dbPath, {
    allowExtension: true,
    open: true,
    readOnly: false,
  })

  sqliteVecExt.load(db)

  // FTS5 table for BM25 search (headers weighted higher)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      id,
      headers,
      content,
      metadata,
      tokenize='porter unicode61'
    )
  `)

  // Vector table for semantic search
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents_meta (
      id TEXT PRIMARY KEY,
      content TEXT,
      metadata TEXT
    )
  `)

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_vec
    USING vec0(embedding float[${dimensions}])
  `)

  return {
    async index(docs: Document[]) {
      if (docs.length === 0)
        return { count: 0 }

      const texts = docs.map(d => d.content)
      const embeddings = await embedder(texts)

      if (embeddings.length !== docs.length)
        throw new Error(`Embedding count mismatch: expected ${docs.length}, got ${embeddings.length}`)

      db.prepare('BEGIN').run()

      try {
        for (let i = 0; i < docs.length; i++) {
          const doc = docs[i]!
          const vector = embeddings[i]!
          const metadataJson = doc.metadata ? JSON.stringify(doc.metadata) : null
          const headers = extractHeaders(doc.content)

          // FTS5: upsert
          db.prepare('DELETE FROM documents_fts WHERE id = ?').run(doc.id)
          db.prepare('INSERT INTO documents_fts (id, headers, content, metadata) VALUES (?, ?, ?, ?)').run(
            doc.id,
            headers,
            doc.content,
            metadataJson,
          )

          // Vector: upsert
          const embedding = new Float32Array(vector)
          const existing = db.prepare('SELECT rowid FROM documents_meta WHERE id = ?').get(doc.id) as { rowid: bigint } | undefined

          if (existing) {
            db.prepare('UPDATE documents_vec SET embedding = ? WHERE rowid = ?').run(embedding, existing.rowid)
            db.prepare('UPDATE documents_meta SET content = ?, metadata = ? WHERE rowid = ?').run(
              doc.content,
              metadataJson,
              existing.rowid,
            )
          }
          else {
            const result = db.prepare('INSERT INTO documents_vec (embedding) VALUES (?)').run(embedding)
            const rowid = result.lastInsertRowid
            db.prepare('INSERT INTO documents_meta (rowid, id, content, metadata) VALUES (?, ?, ?, ?)').run(
              rowid,
              doc.id,
              doc.content,
              metadataJson,
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
      const fetchLimit = limit * 2
      const ftsFilter = compileFilter(filter, 'json', 'meta')
      const vecFilter = compileFilter(filter, 'json')

      // FTS5 search — run AND + OR queries, fuse via RRF for precision + recall
      const tokens = sanitizeFtsTokens(query)
      const andQuery = buildFtsQuery(tokens, 'and')
      const orQuery = buildFtsQuery(tokens, 'or')
      const ftsFilterWhere = ftsFilter.sql ? `AND ${ftsFilter.sql}` : ''

      const ftsStmt = db.prepare(`
        SELECT fts.id, meta.content, meta.metadata, bm25(documents_fts, 0, 2.0, 1.0, 0) as score
        FROM documents_fts fts
        INNER JOIN documents_meta meta ON fts.id = meta.id
        WHERE documents_fts MATCH ?
        ${ftsFilterWhere}
        ORDER BY bm25(documents_fts, 0, 2.0, 1.0, 0)
        LIMIT ?
      `)

      interface FtsRow { id: string, content: string | null, metadata: string | null, score: number }
      const mapFtsRows = (rows: FtsRow[]): SearchResult[] => rows.map((row) => {
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

      const ftsAndResults = andQuery
        ? mapFtsRows(ftsStmt.all(andQuery, ...ftsFilter.params, fetchLimit) as unknown as FtsRow[])
        : []
      // Only run OR if multi-token (single token = same as AND)
      const ftsOrResults = orQuery && orQuery !== andQuery
        ? mapFtsRows(ftsStmt.all(orQuery, ...ftsFilter.params, fetchLimit) as unknown as FtsRow[])
        : []

      // Vector search — rowid IN subquery for native metadata filtering
      const [embedding] = await embedder([query])
      if (!embedding)
        throw new Error('Failed to generate query embedding')

      const queryEmbedding = new Float32Array(embedding)
      const vecFilterWhere = vecFilter.sql
        ? `AND rowid IN (SELECT rowid FROM documents_meta WHERE ${vecFilter.sql})`
        : ''

      const vecRows = db.prepare(`
        SELECT rowid, distance
        FROM documents_vec
        WHERE embedding MATCH ?
        ${vecFilterWhere}
        ORDER BY distance
        LIMIT ?
      `).all(queryEmbedding, ...vecFilter.params, fetchLimit) as Array<{ rowid: bigint, distance: number }>

      const vecResults: SearchResult[] = vecRows.map((row) => {
        const meta = db.prepare('SELECT id, content, metadata FROM documents_meta WHERE rowid = ?')
          .get(row.rowid) as { id: string, content: string | null, metadata: string | null } | undefined

        if (!meta)
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
        if (returnMetadata && meta.metadata)
          result.metadata = JSON.parse(meta.metadata)
        return result
      }).filter(Boolean) as SearchResult[]

      // RRF fusion — AND (precision) + OR (recall, downweighted) + vector (semantic)
      const ftsResultSets: (SearchResult[] | WeightedResultSet)[] = []
      if (ftsAndResults.length)
        ftsResultSets.push(ftsAndResults)
      if (ftsOrResults.length)
        ftsResultSets.push({ results: ftsOrResults, weight: 0.5 })
      const merged = applyRRF([...ftsResultSets, vecResults])
      return merged.slice(0, limit)
    },

    async remove(ids: string[]) {
      db.prepare('BEGIN').run()

      try {
        for (const id of ids) {
          // FTS
          db.prepare('DELETE FROM documents_fts WHERE id = ?').run(id)

          // Vector
          const meta = db.prepare('SELECT rowid FROM documents_meta WHERE id = ?').get(id) as { rowid: bigint } | undefined
          if (meta) {
            db.prepare('DELETE FROM documents_vec WHERE rowid = ?').run(meta.rowid)
            db.prepare('DELETE FROM documents_meta WHERE rowid = ?').run(meta.rowid)
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
      db.exec('DELETE FROM documents_fts')
      db.exec('DELETE FROM documents_vec')
      db.exec('DELETE FROM documents_meta')
    },

    async close() {
      db.close?.()
    },
  }
}

export default sqlite
