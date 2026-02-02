import type { EmbeddingConfig, EmbeddingProvider, ResolvedEmbedding } from '../types'
import { embed, embedMany } from 'ai'
import { createOllama } from 'ollama-ai-provider-v2'

export interface OllamaEmbeddingOptions {
  /** Model name (default: nomic-embed-text) */
  model?: string
  /** Base URL (default: http://localhost:11434) */
  baseUrl?: string
}

/**
 * Ollama embedding provider (local)
 *
 * @example
 * ```ts
 * import { ollama } from 'retriv/embeddings/ollama'
 * import { sqliteVec } from 'retriv/db/sqlite-vec'
 *
 * const db = await sqliteVec({
 *   path: 'vectors.db',
 *   embeddings: ollama({ model: 'nomic-embed-text' }),
 * })
 * ```
 */
export function ollama(options: OllamaEmbeddingOptions = {}): EmbeddingConfig {
  const { model = 'nomic-embed-text', baseUrl } = options
  let cached: ResolvedEmbedding | null = null

  return {
    async resolve() {
      if (cached)
        return cached

      const ollamaBaseUrl = baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
      const ollamaClient = createOllama({
        baseURL: ollamaBaseUrl.endsWith('/api') ? ollamaBaseUrl : `${ollamaBaseUrl}/api`,
      })
      const embeddingModel: any = ollamaClient.textEmbeddingModel(model)

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
