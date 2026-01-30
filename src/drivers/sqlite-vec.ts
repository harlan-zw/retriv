import type { DriverConfig, VectorDbProvider, VectorizeMatches, VectorizeVector } from '../types'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface SqliteVecConfig extends DriverConfig {
  /** Path to SQLite database file. Use ':memory:' for in-memory. */
  path?: string
}

/**
 * Create a sqlite-vec storage provider using node:sqlite + sqlite-vec extension
 * Requires Node.js >= 22.5
 */
export default async function createSqliteVecDriver(
  config: SqliteVecConfig,
): Promise<VectorDbProvider> {
  const dbPath = config.path || ':memory:'
  const { dimensions } = config

  if (!dimensions) {
    throw new Error('[sqlite-vec] dimensions is required')
  }

  // Use node:sqlite directly to enable extension loading
  const nodeSqlite = globalThis.process?.getBuiltinModule?.('node:sqlite') as typeof import('node:sqlite') | undefined
  if (!nodeSqlite) {
    throw new Error('node:sqlite not available. Requires Node.js >= 22.5')
  }

  // Lazy import sqlite-vec
  const sqliteVec = await import('sqlite-vec')

  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true })
  }

  const driver = new nodeSqlite.DatabaseSync(dbPath, {
    allowExtension: true,
    open: true,
    readOnly: false,
  })

  // Load sqlite-vec extension
  sqliteVec.load(driver)

  // Enable foreign keys
  driver.exec('PRAGMA foreign_keys = ON')

  // Create metadata table
  driver.exec(`
    CREATE TABLE IF NOT EXISTS vector_metadata (
      id TEXT PRIMARY KEY,
      namespace TEXT,
      metadata TEXT
    )
  `)

  // Create vec0 virtual table
  driver.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vectors
    USING vec0(embedding float[${dimensions}])
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

      const queryEmbedding = new Float32Array(vector)

      // Query vectors first (vec0 doesn't like JOINs with k parameter)
      const vecSql = `
        SELECT rowid, distance
        FROM vectors
        WHERE embedding MATCH ?
        ORDER BY distance
        LIMIT ?
      `

      const vecStmt = driver.prepare(vecSql)
      const vecResults = vecStmt.all(queryEmbedding, topK) as Array<{
        rowid: bigint
        distance: number
      }>

      // Filter by namespace and fetch metadata
      const matches = vecResults
        .map((row) => {
          const metaStmt = driver.prepare('SELECT id, namespace, metadata FROM vector_metadata WHERE rowid = ?')
          const meta = metaStmt.get(row.rowid) as { id: string, namespace: string | null, metadata: string | null } | undefined

          if (!meta)
            return null
          if (namespace && meta.namespace !== namespace)
            return null

          const match: any = {
            id: meta.id,
            score: Math.max(0, 1 - row.distance), // Clamp to 0-1 range
          }

          if (meta.namespace) {
            match.namespace = meta.namespace
          }

          if (returnMetadata && meta.metadata) {
            match.metadata = JSON.parse(meta.metadata)
          }

          if (returnValues) {
            const vecStmt = driver.prepare('SELECT embedding FROM vectors WHERE rowid = ?')
            const vecResult = vecStmt.get(row.rowid) as { embedding: Float32Array }
            match.values = Array.from(vecResult.embedding)
          }

          return match
        })
        .filter(Boolean)

      return {
        matches,
        count: matches.length,
      }
    },

    async insert(vectors): Promise<{ ids: string[], count: number }> {
      const ids: string[] = []

      driver.prepare('BEGIN').run()

      try {
        for (const vec of vectors) {
          if (vec.values.length !== dimensions) {
            throw new Error(`Vector dimension mismatch: expected ${dimensions}, got ${vec.values.length}`)
          }

          // Check if ID exists
          const checkStmt = driver.prepare('SELECT 1 FROM vector_metadata WHERE id = ?')
          const exists = checkStmt.get(vec.id)
          if (exists) {
            throw new Error(`Vector with id ${vec.id} already exists`)
          }

          const embedding = new Float32Array(Array.isArray(vec.values) ? vec.values : Array.from(vec.values))

          // Insert into vec0 table
          const vecStmt = driver.prepare('INSERT INTO vectors (embedding) VALUES (?)')
          const vecResult = vecStmt.run(embedding)
          const rowid = vecResult.lastInsertRowid

          // Insert metadata
          const metaStmt = driver.prepare(
            'INSERT INTO vector_metadata (rowid, id, namespace, metadata) VALUES (?, ?, ?, ?)',
          )
          metaStmt.run(
            rowid,
            vec.id,
            vec.namespace || null,
            vec.metadata ? JSON.stringify(vec.metadata) : null,
          )

          ids.push(vec.id)
        }

        driver.prepare('COMMIT').run()

        return { ids, count: ids.length }
      }
      catch (error) {
        driver.prepare('ROLLBACK').run()
        throw error
      }
    },

    async upsert(vectors): Promise<{ ids: string[], count: number }> {
      const ids: string[] = []

      driver.prepare('BEGIN').run()

      try {
        for (const vec of vectors) {
          if (vec.values.length !== dimensions) {
            throw new Error(`Vector dimension mismatch: expected ${dimensions}, got ${vec.values.length}`)
          }

          const embedding = new Float32Array(Array.isArray(vec.values) ? vec.values : Array.from(vec.values))

          // Check if ID exists
          const checkStmt = driver.prepare('SELECT rowid FROM vector_metadata WHERE id = ?')
          const existing = checkStmt.get(vec.id) as { rowid: bigint } | undefined

          if (existing) {
            // Update existing
            const vecStmt = driver.prepare('UPDATE vectors SET embedding = ? WHERE rowid = ?')
            vecStmt.run(embedding, existing.rowid)

            const metaStmt = driver.prepare(
              'UPDATE vector_metadata SET namespace = ?, metadata = ? WHERE rowid = ?',
            )
            metaStmt.run(
              vec.namespace || null,
              vec.metadata ? JSON.stringify(vec.metadata) : null,
              existing.rowid,
            )
          }
          else {
            // Insert new
            const vecStmt = driver.prepare('INSERT INTO vectors (embedding) VALUES (?)')
            const vecResult = vecStmt.run(embedding)
            const rowid = vecResult.lastInsertRowid

            const metaStmt = driver.prepare(
              'INSERT INTO vector_metadata (rowid, id, namespace, metadata) VALUES (?, ?, ?, ?)',
            )
            metaStmt.run(
              rowid,
              vec.id,
              vec.namespace || null,
              vec.metadata ? JSON.stringify(vec.metadata) : null,
            )
          }

          ids.push(vec.id)
        }

        driver.prepare('COMMIT').run()

        return { ids, count: ids.length }
      }
      catch (error) {
        driver.prepare('ROLLBACK').run()
        throw error
      }
    },

    async getAll(): Promise<VectorizeVector[]> {
      const sql = `
        SELECT v.rowid, v.embedding, m.id, m.namespace, m.metadata
        FROM vectors v
        JOIN vector_metadata m ON v.rowid = m.rowid
      `
      const stmt = driver.prepare(sql)
      const rows = stmt.all() as Array<{
        rowid: bigint
        embedding: Float32Array
        id: string
        namespace: string | null
        metadata: string | null
      }>

      return rows.map(row => ({
        id: row.id,
        values: row.embedding,
        namespace: row.namespace || undefined,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      }))
    },

    async close(): Promise<void> {
      if (driver.close) {
        driver.close()
      }
    },
  }
}

export { createSqliteVecDriver }
