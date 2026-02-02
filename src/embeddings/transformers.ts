import type { EmbeddingConfig, EmbeddingProvider, ResolvedEmbedding } from '../types'
import { pipeline } from '@huggingface/transformers'

export interface TransformersEmbeddingOptions {
  /** Model name (default: Xenova/bge-base-en-v1.5) */
  model?: string
}

/**
 * Transformers.js embedding provider (local, in-browser compatible)
 *
 * @example
 * ```ts
 * import { transformers } from 'retriv/embeddings/transformers'
 * import { sqliteVec } from 'retriv/db/sqlite-vec'
 *
 * const db = await sqliteVec({
 *   path: 'vectors.db',
 *   embeddings: transformers({ model: 'Xenova/bge-base-en-v1.5' }),
 * })
 * ```
 */
export function transformers(options: TransformersEmbeddingOptions = {}): EmbeddingConfig {
  const { model = 'Xenova/bge-base-en-v1.5' } = options
  let cached: ResolvedEmbedding | null = null

  return {
    async resolve() {
      if (cached)
        return cached

      const extractor = await pipeline('feature-extraction', model, { dtype: 'fp32' })

      const embedder: EmbeddingProvider = async (texts) => {
        const results: number[][] = []
        for (const text of texts) {
          const output = await extractor(text, { pooling: 'mean', normalize: true })
          results.push(Array.from(output.data as Float32Array))
        }
        return results
      }

      // Get dimensions from test embedding
      const testResult = await embedder(['test'])
      const dimensions = testResult[0].length

      cached = { embedder, dimensions }
      return cached
    },
  }
}
