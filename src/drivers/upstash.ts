import type { DriverConfig, VectorDbProvider, VectorizeMatches } from '../types'

export interface UpstashConfig extends DriverConfig {
  /** Upstash Vector REST URL */
  url: string
  /** Upstash Vector REST token */
  token: string
  /** Optional namespace for vectors */
  namespace?: string
}

/**
 * Create an Upstash Vector storage provider
 * Uses text-native embeddings (no separate embedding model needed)
 */
export default async function createUpstashDriver(
  config: UpstashConfig,
): Promise<VectorDbProvider> {
  const { url, token, dimensions, namespace } = config

  if (!url) {
    throw new Error('[upstash] url is required')
  }

  if (!token) {
    throw new Error('[upstash] token is required')
  }

  if (!dimensions) {
    throw new Error('[upstash] dimensions is required')
  }

  // Lazy import
  const { Index } = await import('@upstash/vector')

  const index = new Index({ url, token })

  return {
    mode: 'text',
    dimensions,

    async query(text, options = {}) {
      const { topK = 10 } = options as any

      const queryParams = {
        data: text,
        topK,
        includeVectors: true,
        includeMetadata: true,
        includeData: true,
        queryMode: 'DENSE' as const,
      } as any

      const results = await index.query(queryParams, {
        namespace: namespace || 'chunks',
      })

      return {
        matches: (results || []).map((m): any => ({
          id: m.id,
          score: Math.max(0, Math.min(1, m.score)),
          ...(m.vector && { values: m.vector }),
          ...(namespace && { namespace }),
          ...(m.metadata && { metadata: m.metadata }),
        })),
        count: results?.length || 0,
      } as VectorizeMatches
    },

    async insert(vectors) {
      if (vectors.length === 0) {
        return { ids: [], count: 0 }
      }

      // Validate dimensions
      for (const vec of vectors) {
        if (vec.values.length !== dimensions) {
          throw new Error(`Vector dimension mismatch: expected ${dimensions}, got ${vec.values.length}`)
        }
      }

      // Transform to Upstash format
      const upstashVectors = vectors.map(vec => ({
        id: vec.id,
        vector: Array.isArray(vec.values) ? Array.from(vec.values) : Array.from(vec.values),
        ...(vec.metadata && { metadata: vec.metadata }),
      }))

      // Upstash doesn't have separate insert (uses upsert)
      await index.upsert(upstashVectors, { namespace: namespace || vectors[0]?.namespace })

      const ids = vectors.map(v => v.id)

      return { ids, count: ids.length }
    },

    async upsert(vectors) {
      if (vectors.length === 0) {
        return { ids: [], count: 0 }
      }

      // Check if this is text-based upsert (from adapter)
      const isTextMode = vectors.some(v => v.metadata?._text && (!v.values || v.values.length === 0))
      if (isTextMode) {
        // Text-based upsert - use Upstash's data parameter
        const upstashVectors = vectors.map((vec) => {
          const { _text, ...restMetadata } = vec.metadata as any || {}
          return {
            id: vec.id,
            data: _text,
            metadata: restMetadata,
          }
        })

        const ns = namespace || vectors[0]?.namespace

        await index.upsert(upstashVectors, ns ? { namespace: ns } : undefined)

        const ids = vectors.map(v => v.id)

        return { ids, count: ids.length }
      }

      // Vector-based upsert (fallback for compatibility)
      // Validate dimensions
      for (const vec of vectors) {
        if (vec.values.length !== dimensions) {
          throw new Error(`Vector dimension mismatch: expected ${dimensions}, got ${vec.values.length}`)
        }
      }

      // Transform to Upstash format
      const upstashVectors = vectors.map(vec => ({
        id: vec.id,
        vector: Array.isArray(vec.values) ? Array.from(vec.values) : Array.from(vec.values),
        ...(vec.metadata && { metadata: vec.metadata }),
      }))

      const ns = namespace || vectors[0]?.namespace

      await index.upsert(upstashVectors, { namespace: ns })

      const ids = vectors.map(v => v.id)

      return { ids, count: ids.length }
    },

    async close() {
      // No-op for Upstash
    },
  }
}

export { createUpstashDriver }
