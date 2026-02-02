import type { EmbeddingConfig, EmbeddingProvider, ResolvedEmbedding } from '../types'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { embed, embedMany } from 'ai'

export interface GoogleEmbeddingOptions {
  /** Model name (default: text-embedding-004) */
  model?: string
  /** API key (falls back to GOOGLE_API_KEY env) */
  apiKey?: string
  /** Base URL override */
  baseUrl?: string
}

/**
 * Google AI embedding provider
 *
 * @example
 * ```ts
 * import { google } from 'retriv/embeddings/google'
 * import { sqliteVec } from 'retriv/db/sqlite-vec'
 *
 * const db = await sqliteVec({
 *   path: 'vectors.db',
 *   embeddings: google({ model: 'text-embedding-004' }),
 * })
 * ```
 */
export function google(options: GoogleEmbeddingOptions = {}): EmbeddingConfig {
  const { model = 'text-embedding-004', apiKey, baseUrl } = options
  let cached: ResolvedEmbedding | null = null

  return {
    async resolve() {
      if (cached)
        return cached

      const googleClient = createGoogleGenerativeAI({ apiKey, baseURL: baseUrl })
      const embeddingModel = googleClient.textEmbeddingModel(model)

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
