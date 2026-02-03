import type { BaseDriverConfig, Document, EmbeddingConfig, SearchOptions, SearchProvider, SearchResult } from '../types'
import { resolveEmbedding } from '../embeddings/resolve'
import { matchesFilter } from '../filter'
import { extractSnippet } from '../utils/extract-snippet'

// Cloudflare Vectorize binding type
interface VectorizeIndexBinding {
  query: (vector: number[], options?: any) => Promise<{ matches: any[], count?: number }>
  insert: (vectors: any[]) => Promise<void>
  upsert: (vectors: any[]) => Promise<void>
  deleteByIds: (ids: string[]) => Promise<void>
}

export interface CloudflareConfig extends BaseDriverConfig {
  /** Cloudflare Vectorize binding instance */
  binding: VectorizeIndexBinding
  /** Embedding provider from retriv/embeddings/ */
  embeddings: EmbeddingConfig
}

/**
 * Create a Cloudflare Vectorize search provider
 * For use in Cloudflare Workers at runtime
 *
 * @example
 * ```ts
 * import { cloudflare } from 'retriv/db/cloudflare'
 * import { openai } from 'retriv/embeddings/openai'
 *
 * const db = await cloudflare({
 *   binding: env.VECTORIZE,
 *   embeddings: openai({ model: 'text-embedding-3-small' }),
 * })
 * ```
 */
export async function cloudflare(config: CloudflareConfig): Promise<SearchProvider> {
  const { binding } = config

  if (!binding) {
    throw new Error('[cloudflare] binding is required')
  }

  if (!config.embeddings) {
    throw new Error('[cloudflare] embeddings is required')
  }

  // Resolve embedding provider
  const { embedder } = await resolveEmbedding(config.embeddings)

  return {
    async index(docs: Document[]) {
      if (docs.length === 0) {
        return { count: 0 }
      }

      const texts = docs.map(d => d.content)
      const embeddings = await embedder(texts)

      if (embeddings.length !== docs.length) {
        throw new Error(`Embedding count mismatch: expected ${docs.length}, got ${embeddings.length}`)
      }

      const vectors = docs.map((doc, i) => ({
        id: doc.id,
        values: embeddings[i]!,
        metadata: {
          ...doc.metadata,
          _content: doc.content,
        },
      }))

      await binding.upsert(vectors)

      return { count: docs.length }
    },

    async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
      const { limit = 10, returnContent = false, returnMetadata = true, filter } = options
      const fetchLimit = filter ? limit * 4 : limit

      const [embedding] = await embedder([query])
      if (!embedding) {
        throw new Error('Failed to generate query embedding')
      }

      const results = await binding.query(embedding, {
        topK: fetchLimit,
        returnValues: false,
        returnMetadata: true,
      })

      let mapped = (results.matches || []).map((m: any) => {
        const { _content, ...rest } = m.metadata || {}
        const result: SearchResult = {
          id: m.id,
          score: Math.max(0, Math.min(1, m.score)),
        }

        if (returnContent && _content) {
          const { snippet, highlights } = extractSnippet(_content, query)
          result.content = snippet
          if (highlights.length)
            result._meta = { ...result._meta, highlights }
        }

        if (Object.keys(rest).length > 0)
          result.metadata = rest

        return result
      })

      if (filter)
        mapped = mapped.filter(r => matchesFilter(filter, r.metadata))

      if (!returnMetadata)
        mapped.forEach((r) => { delete r.metadata })

      return mapped.slice(0, limit)
    },

    async remove(ids: string[]) {
      await binding.deleteByIds(ids)
      return { count: ids.length }
    },

    async clear() {
      throw new Error('[cloudflare] clear() is not supported - use wrangler CLI instead')
    },

    async close() {
      // Cloudflare bindings don't need to be closed
    },
  }
}

export default cloudflare
