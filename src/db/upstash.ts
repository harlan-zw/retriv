import type { BaseDriverConfig, Document, SearchOptions, SearchProvider, SearchResult } from '../types'
import { Index } from '@upstash/vector'

export interface UpstashConfig extends BaseDriverConfig {
  /** Upstash Vector REST URL */
  url: string
  /** Upstash Vector REST token */
  token: string
  /** Optional namespace for vectors */
  namespace?: string
}

/**
 * Create an Upstash Vector search provider
 * Text-native: Uses Upstash's server-side embeddings (no local embedding needed)
 *
 * @example
 * ```ts
 * import { upstash } from 'retriv/db/upstash'
 *
 * const db = await upstash({
 *   url: process.env.UPSTASH_VECTOR_URL,
 *   token: process.env.UPSTASH_VECTOR_TOKEN,
 * })
 * ```
 */
export async function upstash(config: UpstashConfig): Promise<SearchProvider> {
  const { url, token, namespace } = config

  if (!url) {
    throw new Error('[upstash] url is required')
  }

  if (!token) {
    throw new Error('[upstash] token is required')
  }

  const index = new Index({ url, token })
  const ns = namespace || 'chunks'

  return {
    async index(docs: Document[]) {
      if (docs.length === 0) {
        return { count: 0 }
      }

      const upstashVectors = docs.map(doc => ({
        id: doc.id,
        data: doc.content,
        metadata: {
          ...doc.metadata,
          _content: doc.content,
        },
      }))

      await index.upsert(upstashVectors, { namespace: ns })

      return { count: docs.length }
    },

    async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
      const { limit = 10, returnContent = false, returnMetadata = true } = options

      const results = await index.query({
        data: query,
        topK: limit,
        includeMetadata: true,
        includeData: true,
      } as any, { namespace: ns })

      return (results || []).map((m: any) => {
        const result: SearchResult = {
          id: m.id,
          score: Math.max(0, Math.min(1, m.score)),
        }

        if (returnContent && m.metadata?._content) {
          result.content = m.metadata._content
        }

        if (returnMetadata && m.metadata) {
          const { _content, ...rest } = m.metadata
          if (Object.keys(rest).length > 0) {
            result.metadata = rest
          }
        }

        return result
      })
    },

    async remove(ids: string[]) {
      await index.delete(ids, { namespace: ns })
      return { count: ids.length }
    },

    async clear() {
      await index.reset({ namespace: ns })
    },

    async close() {
      // No-op for Upstash
    },
  }
}

export default upstash
