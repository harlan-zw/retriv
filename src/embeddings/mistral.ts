import type { EmbeddingConfig, EmbeddingProvider, ResolvedEmbedding } from '../types'
import { createMistral } from '@ai-sdk/mistral'
import { embed, embedMany } from 'ai'
import { getModelDimensions } from './model-info'

export interface MistralEmbeddingOptions {
  /** Model name (default: mistral-embed) */
  model?: string
  /** API key (falls back to MISTRAL_API_KEY env) */
  apiKey?: string
  /** Base URL override */
  baseUrl?: string
}

/**
 * Mistral AI embedding provider
 *
 * @example
 * ```ts
 * import { mistral } from 'retriv/embeddings/mistral'
 * import { sqliteVec } from 'retriv/db/sqlite-vec'
 *
 * const db = await sqliteVec({
 *   path: 'vectors.db',
 *   embeddings: mistral({ model: 'mistral-embed' }),
 * })
 * ```
 */
export function mistral(options: MistralEmbeddingOptions = {}): EmbeddingConfig {
  const { model = 'mistral-embed', apiKey, baseUrl } = options
  let cached: ResolvedEmbedding | null = null

  return {
    async resolve() {
      if (cached)
        return cached

      const mistralClient = createMistral({ apiKey, baseURL: baseUrl })
      const embeddingModel = mistralClient.textEmbeddingModel(model)

      let dimensions = getModelDimensions(model)
      if (!dimensions) {
        const { embedding } = await embed({ model: embeddingModel, value: 'test' })
        dimensions = embedding.length
      }

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
