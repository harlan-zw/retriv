import type { EmbeddingConfig, EmbeddingProvider, ResolvedEmbedding } from '../types'
import { rm } from 'node:fs/promises'
import { env, pipeline } from '@huggingface/transformers'
import { getModelDimensions, resolveModelForPreset } from './model-info'

export interface TransformersEmbeddingOptions {
  /** Model name (e.g., 'bge-base-en-v1.5' or 'Xenova/bge-base-en-v1.5') */
  model?: string
  /** Embedding dimensions (auto-detected for known models) */
  dimensions?: number
}

/**
 * Clear corrupted model cache, returns true if cleared and retry should be attempted
 */
async function clearCorruptedCache(error: unknown, model: string): Promise<boolean> {
  const isProtobufError = error instanceof Error
    && (error.message?.includes('Protobuf parsing failed') || String(error.cause)?.includes('Protobuf parsing failed'))

  if (!isProtobufError || !env.cacheDir)
    return false

  const modelPath = `${env.cacheDir}/${model}`
  await rm(modelPath, { recursive: true, force: true }).catch(() => {})
  console.warn(`[retriv] Cleared corrupted model cache for ${model}, retrying...`)
  return true
}

/**
 * Transformers.js embedding provider (local, in-browser compatible)
 *
 * @example
 * ```ts
 * import { transformersJs } from 'retriv/embeddings/transformers-js'
 * import { sqliteVec } from 'retriv/db/sqlite-vec'
 *
 * // Auto-resolves model name and dimensions for known models
 * const db = await sqliteVec({
 *   path: 'vectors.db',
 *   embeddings: transformersJs({ model: 'bge-base-en-v1.5' }),
 * })
 * ```
 */
export function transformersJs(options: TransformersEmbeddingOptions = {}): EmbeddingConfig {
  const baseModel = options.model ?? 'bge-small-en-v1.5'
  const model = resolveModelForPreset(baseModel, 'transformers.js')
  let cached: ResolvedEmbedding | null = null

  return {
    async resolve() {
      if (cached)
        return cached

      const extractor = await pipeline('feature-extraction', model, { dtype: 'fp32' })
        .catch(async (err) => {
          if (await clearCorruptedCache(err, model))
            return pipeline('feature-extraction', model, { dtype: 'fp32' })
          throw err
        })

      const dimensions = options.dimensions ?? getModelDimensions(model)
      if (!dimensions)
        throw new Error(`Unknown dimensions for model ${model}. Please specify dimensions option.`)

      const embedder: EmbeddingProvider = async (texts) => {
        const results: number[][] = []
        for (const text of texts) {
          const output = await extractor(text, { pooling: 'mean', normalize: true })
          results.push(Array.from(output.data as Float32Array))
        }
        return results
      }

      cached = { embedder, dimensions }
      return cached
    },
  }
}
