import type { DriverConfig, VectorDbProvider, VectorizeMatches, VectorizeVector } from '../types'

export interface CloudflareConfig extends DriverConfig {
  /** Cloudflare Vectorize binding instance */
  binding: VectorizeIndex
  /** Optional binding name for logging */
  bindingName?: string
}

/**
 * Create a Cloudflare Vectorize storage provider
 * For use in Cloudflare Workers at runtime
 *
 * @example
 * ```ts
 * const vectorize = event.context.cloudflare.env.VECTORIZE
 * const db = await createCloudflareDriver({ binding: vectorize, dimensions: 768 })
 * ```
 */
export default async function createCloudflareDriver(
  config: CloudflareConfig,
): Promise<VectorDbProvider> {
  const { binding, dimensions } = config

  if (!binding) {
    throw new Error('[cloudflare-vectorize] binding is required')
  }

  if (!dimensions) {
    throw new Error('[cloudflare-vectorize] dimensions is required')
  }

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

      // Query Cloudflare Vectorize binding
      const results = await binding.query(vector, {
        topK,
        ...(namespace && { namespace }),
        returnValues,
        returnMetadata,
      })

      // Convert Cloudflare results to our VectorizeMatches format
      return {
        matches: (results.matches || []).map((m: any) => ({
          id: m.id,
          score: Math.max(0, Math.min(1, m.score)), // Clamp to 0-1 range
          ...(m.namespace && { namespace: m.namespace }),
          ...(m.values && { values: Array.isArray(m.values) ? m.values : Array.from(m.values) }),
          ...(m.metadata && { metadata: m.metadata }),
        })),
        count: results.count || results.matches?.length || 0,
      }
    },

    async insert(vectors): Promise<{ ids: string[], count: number }> {
      if (vectors.length === 0) {
        return { ids: [], count: 0 }
      }

      // Validate dimensions
      for (const vec of vectors) {
        if (vec.values.length !== dimensions) {
          throw new Error(`Vector dimension mismatch: expected ${dimensions}, got ${vec.values.length}`)
        }
      }

      // Transform to Cloudflare Vectorize format
      const vectorizeVectors = vectors.map(vec => ({
        id: vec.id,
        values: Array.isArray(vec.values) ? Array.from(vec.values) : Array.from(vec.values),
        ...(vec.namespace && { namespace: vec.namespace }),
        ...(vec.metadata && { metadata: vec.metadata }),
      }))

      await binding.insert(vectorizeVectors)

      const ids = vectors.map(v => v.id)

      return { ids, count: ids.length }
    },

    async upsert(vectors): Promise<{ ids: string[], count: number }> {
      if (vectors.length === 0) {
        return { ids: [], count: 0 }
      }

      // Validate dimensions
      for (const vec of vectors) {
        if (vec.values.length !== dimensions) {
          throw new Error(`Vector dimension mismatch: expected ${dimensions}, got ${vec.values.length}`)
        }
      }

      // Transform to Cloudflare Vectorize format
      const vectorizeVectors = vectors.map(vec => ({
        id: vec.id,
        values: Array.isArray(vec.values) ? Array.from(vec.values) : Array.from(vec.values),
        ...(vec.namespace && { namespace: vec.namespace }),
        ...(vec.metadata && { metadata: vec.metadata }),
      }))

      await binding.upsert(vectorizeVectors)

      const ids = vectors.map(v => v.id)

      return { ids, count: ids.length }
    },

    async getAll(): Promise<VectorizeVector[]> {
      // Cloudflare Vectorize doesn't support getAll
      throw new Error('[cloudflare-vectorize] getAll is not supported')
    },

    async close(): Promise<void> {
      // Cloudflare bindings don't need to be closed
    },
  }
}

export { createCloudflareDriver }
