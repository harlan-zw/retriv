import type { EmbeddingConfig, EmbeddingProvider, ResolvedEmbedding } from '../types'
import { createCohere } from '@ai-sdk/cohere'
import { embed, embedMany } from 'ai'

export interface CohereEmbeddingOptions {
  /** Model name (default: embed-english-v3.0) */
  model?: string
  /** API key (falls back to COHERE_API_KEY env) */
  apiKey?: string
  /** Base URL override */
  baseUrl?: string
}

/**
 * Cohere embedding provider
 *
 * @example
 * ```ts
 * import { cohere } from 'retriv/embeddings/cohere'
 * import { sqliteVec } from 'retriv/db/sqlite-vec'
 *
 * const db = await sqliteVec({
 *   path: 'vectors.db',
 *   embeddings: cohere({ model: 'embed-english-v3.0' }),
 * })
 * ```
 */
export function cohere(options: CohereEmbeddingOptions = {}): EmbeddingConfig {
  const { model = 'embed-english-v3.0', apiKey, baseUrl } = options
  let cached: ResolvedEmbedding | null = null

  return {
    async resolve() {
      if (cached)
        return cached

      const cohereClient = createCohere({ apiKey, baseURL: baseUrl })
      const embeddingModel = cohereClient.textEmbeddingModel(model)

      const { embedding: testEmbedding } = await embed({ model: embeddingModel, value: 'test' })
      const dimensions = testEmbedding.length

      const embedder: EmbeddingProvider = async (texts) => {
        if (texts.length === 0)
          return []
        if (texts.length === 1) {
          const { embedding } = await embed({ model: embeddingModel, value: texts[0] })
          return [embedding]
        }
        const { embeddings } = await embedMany({ model: embeddingModel, values: texts })
        return embeddings
      }

      cached = { embedder, dimensions }
      return cached
    },
  }
}
