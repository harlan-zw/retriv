import type { Reranker, RerankerConfig, SearchResult } from '../types'

/** Jina reranker models */
export type JinaRerankerModel
  = | 'jina-reranker-v2-base-multilingual'
    | 'jina-reranker-v1-base-en'
    | 'jina-reranker-v1-turbo-en'
    | 'jina-reranker-v1-tiny-en'
    | (string & {})

export interface JinaRerankerConfig {
  /** Model name (default: 'jina-reranker-v2-base-multilingual') */
  model?: JinaRerankerModel
  /** API key (falls back to JINA_API_KEY env) */
  apiKey?: string
  /** Base URL override (default: 'https://api.jina.ai/v1') */
  baseUrl?: string
  /** Number of top results to return from API (default: all) */
  topN?: number
}

export function jinaReranker(config: JinaRerankerConfig = {}): RerankerConfig {
  const {
    model = 'jina-reranker-v2-base-multilingual',
    apiKey,
    baseUrl = 'https://api.jina.ai/v1',
    topN,
  } = config

  let cached: Reranker | null = null

  return {
    async resolve() {
      if (cached)
        return cached

      const key = apiKey || process.env.JINA_API_KEY
      if (!key)
        throw new Error('Jina API key required: pass apiKey or set JINA_API_KEY env')

      cached = async (query: string, results: SearchResult[]): Promise<SearchResult[]> => {
        if (results.length === 0)
          return results

        const withContent = results.filter(r => r.content)
        const withoutContent = results.filter(r => !r.content)

        if (withContent.length === 0)
          return results

        const res = await fetch(`${baseUrl}/rerank`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`,
          },
          body: JSON.stringify({
            model,
            query,
            documents: withContent.map(r => r.content),
            ...(topN && { top_n: topN }),
          }),
        })

        if (!res.ok) {
          const body = await res.text().catch(() => '')
          throw new Error(`Jina rerank failed (${res.status}): ${body}`)
        }

        const data = await res.json() as {
          results: Array<{ index: number, relevance_score: number }>
        }

        const scored = data.results.map(r => ({
          ...withContent[r.index],
          score: r.relevance_score,
        }))

        scored.sort((a, b) => b.score - a.score)
        return [...scored, ...withoutContent]
      }

      return cached
    },
  }
}

export default jinaReranker
