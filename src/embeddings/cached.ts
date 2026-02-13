import type { Embedding, EmbeddingConfig, EmbeddingProvider, ResolvedEmbedding } from '../types'
import { createHash } from 'node:crypto'

export interface EmbeddingCacheStorage {
  /** Get cached embedding by text hash, returns null on miss */
  get: (hash: string) => Embedding | null
  /** Store embedding by text hash */
  set: (hash: string, embedding: Embedding) => void
}

export interface CachedEmbeddingOptions {
  /** Cache storage backend */
  storage: EmbeddingCacheStorage
}

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * Wrap an EmbeddingConfig with content-addressed caching.
 *
 * Serves cached embeddings for previously-seen text and only
 * computes new ones for cache misses. Useful when re-indexing
 * documents where most content is unchanged (e.g., package version bumps).
 *
 * @example
 * ```ts
 * import { cachedEmbeddings } from 'retriv/embeddings/cached'
 * import { transformersJs } from 'retriv/embeddings/transformers-js'
 *
 * const embeddings = cachedEmbeddings(transformersJs(), {
 *   storage: myCacheStorage,
 * })
 * ```
 */
export function cachedEmbeddings(config: EmbeddingConfig, options: CachedEmbeddingOptions): EmbeddingConfig {
  const { storage } = options

  return {
    async resolve(): Promise<ResolvedEmbedding> {
      const resolved = await config.resolve()

      const cachedEmbedder: EmbeddingProvider = async (texts) => {
        const results: (Embedding | undefined)[] = Array.from({ length: texts.length })
        const misses: { index: number, text: string }[] = []

        for (let i = 0; i < texts.length; i++) {
          const h = hash(texts[i])
          const cached = storage.get(h)
          if (cached) {
            results[i] = cached
          }
          else {
            misses.push({ index: i, text: texts[i] })
          }
        }

        if (misses.length > 0) {
          const computed = await resolved.embedder(misses.map(m => m.text))
          for (let i = 0; i < misses.length; i++) {
            const embedding = computed[i]
            results[misses[i].index] = embedding
            storage.set(hash(misses[i].text), embedding)
          }
        }

        return results as Embedding[]
      }

      return { ...resolved, embedder: cachedEmbedder }
    },
  }
}
