import type { VectorDbProvider, VectorizeMatches, VectorizeQueryOptions, VectorizeVector } from './types'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

/**
 * Text-based adapter for vector databases
 * Provides unified text API and handles embedding transforms when needed
 */
export interface EmbedderAdapter {
  /**
   * Query with text string (adapter handles embedding if needed)
   */
  query: (text: string, options?: VectorizeQueryOptions) => Promise<VectorizeMatches>

  /**
   * Upsert items with text (adapter handles embedding if needed)
   */
  upsert: (items: Array<{ id: string, text: string, metadata?: Record<string, any> }>) => Promise<{ ids: string[], count: number }>

  /**
   * Import vectors from JSONL file or stream
   * Each line: {"id":"...","values":[...],"namespace":"...","metadata":{...}}
   */
  importFromJsonl: (source: string | NodeJS.ReadableStream) => Promise<{ count: number }>

  /**
   * Get all vectors from the index (for dump/export)
   * Returns undefined if driver doesn't support this
   */
  getAll?: () => Promise<VectorizeVector[]>

  /**
   * Close underlying driver
   */
  close?: () => Promise<void>
}

export interface EmbedderAdapterConfig {
  /**
   * AI SDK embedding model (required for vector mode drivers)
   * Adapter will handle embed/embedMany calls internally
   */
  embeddingModel?: any

  /**
   * Override driver mode detection
   */
  mode?: 'text' | 'vector'
}

/**
 * Create embedder adapter for a vector DB driver
 * Provides text-based API and handles embedding transforms internally
 */
export async function createAdapter(
  driver: VectorDbProvider,
  config: EmbedderAdapterConfig = {},
): Promise<EmbedderAdapter> {
  const mode = config.mode ?? driver.mode
  const { embeddingModel } = config

  // Text mode (Upstash, etc): Pass text directly through, no embedding provider needed
  if (mode === 'text') {
    return {
      async query(text: string, options?: VectorizeQueryOptions): Promise<VectorizeMatches> {
        // Pass text directly - text mode drivers handle string input
        return driver.query(text as any, options)
      },

      async upsert(items) {
        // Convert text items to vectors with text in metadata
        const vectors: VectorizeVector[] = items.map(item => ({
          id: item.id,
          values: [], // Empty for text mode - driver handles text
          metadata: {
            ...item.metadata,
            _text: item.text, // Store text in metadata for driver
          },
        }))
        return driver.upsert(vectors)
      },

      async importFromJsonl(source: string | NodeJS.ReadableStream) {
        // Batch import via driver.upsert
        let count = 0
        const batchSize = 100
        let batch: VectorizeVector[] = []

        const stream = typeof source === 'string' ? createReadStream(source) : source
        const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY })

        for await (const line of rl) {
          if (!line.trim())
            continue

          const vec = JSON.parse(line) as VectorizeVector
          batch.push(vec)

          if (batch.length >= batchSize) {
            await driver.upsert(batch)
            count += batch.length
            batch = []
          }
        }

        // Process final batch
        if (batch.length > 0) {
          await driver.upsert(batch)
          count += batch.length
        }

        return { count }
      },

      getAll: driver.getAll ? () => driver.getAll!() : undefined,

      async close() {
        return driver.close?.()
      },
    }
  }

  // Vector mode (sqlite-vec, libsql, etc): Generate embeddings first
  if (!embeddingModel) {
    throw new Error('embeddingModel required for vector mode drivers')
  }

  // Use AI SDK embed/embedMany
  const { embed, embedMany } = await import('ai')

  return {
    async query(text: string, options?: VectorizeQueryOptions): Promise<VectorizeMatches> {
      // Generate embedding for query text
      const { embedding } = await embed({ model: embeddingModel, value: text })

      if (!embedding) {
        throw new Error('Failed to generate query embedding')
      }

      return driver.query(embedding, options)
    },

    async upsert(items) {
      // Generate embeddings for all text items
      const texts = items.map(item => item.text)
      const { embeddings } = await embedMany({ model: embeddingModel, values: texts })

      if (!embeddings || embeddings.length !== items.length) {
        throw new Error(`Embedding count mismatch: expected ${items.length}, got ${embeddings?.length ?? 0}`)
      }

      // Convert to vectors
      const vectors: VectorizeVector[] = items.map((item, idx) => ({
        id: item.id,
        values: embeddings[idx]!,
        metadata: item.metadata,
      }))

      return driver.upsert(vectors)
    },

    async importFromJsonl(source: string | NodeJS.ReadableStream) {
      // Batch import via driver.upsert - JSONL already has embeddings
      let count = 0
      const batchSize = 1000
      let batch: VectorizeVector[] = []

      const stream = typeof source === 'string' ? createReadStream(source) : source
      const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY })

      for await (const line of rl) {
        if (!line.trim())
          continue

        const vec = JSON.parse(line) as VectorizeVector
        batch.push(vec)

        if (batch.length >= batchSize) {
          await driver.upsert(batch)
          count += batch.length
          batch = []
        }
      }

      // Process final batch
      if (batch.length > 0) {
        await driver.upsert(batch)
        count += batch.length
      }

      return { count }
    },

    getAll: driver.getAll ? () => driver.getAll!() : undefined,

    async close() {
      return driver.close?.()
    },
  }
}
