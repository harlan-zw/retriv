import type { EmbeddingConfig, EmbeddingProvider, ResolvedEmbedding } from '../types'
import { createOpenAI } from '@ai-sdk/openai'
import { embed, embedMany } from 'ai'

export interface OpenAIEmbeddingOptions {
  /** Model name (default: text-embedding-3-small) */
  model?: string
  /** API key (falls back to OPENAI_API_KEY env) */
  apiKey?: string
  /** Base URL override */
  baseUrl?: string
}

/**
 * OpenAI embedding provider
 *
 * @example
 * ```ts
 * import { openai } from 'retriv/embeddings/openai'
 * import { sqliteVec } from 'retriv/db/sqlite-vec'
 *
 * const db = await sqliteVec({
 *   path: 'vectors.db',
 *   embeddings: openai({ model: 'text-embedding-3-small' }),
 * })
 * ```
 */
export function openai(options: OpenAIEmbeddingOptions = {}): EmbeddingConfig {
  const { model = 'text-embedding-3-small', apiKey, baseUrl } = options
  let cached: ResolvedEmbedding | null = null

  return {
    async resolve() {
      if (cached)
        return cached

      const openaiClient = createOpenAI({ apiKey, baseURL: baseUrl })
      const embeddingModel = openaiClient.textEmbeddingModel(model)

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
