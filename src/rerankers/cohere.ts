import type { Reranker, RerankerConfig, SearchResult } from '../types'

/** Cohere rerank models */
export type CohereRerankerModel
  = | 'rerank-v3.5'
    | 'rerank-english-v3.0'
    | 'rerank-multilingual-v3.0'
    | 'rerank-english-v2.0'
    | (string & {})

export interface CohereRerankerConfig {
  /** Model name (default: 'rerank-v3.5') */
  model?: CohereRerankerModel
  /** API key (falls back to COHERE_API_KEY env) */
  apiKey?: string
  /** Base URL override (default: 'https://api.cohere.com/v2') */
  baseUrl?: string
  /** Number of top results to return from API (default: all) */
  topN?: number
}

export function cohereReranker(config: CohereRerankerConfig = {}): RerankerConfig {
  const {
    model = 'rerank-v3.5',
    apiKey,
    baseUrl = 'https://api.cohere.com/v2',
    topN,
  } = config

  let cached: Reranker | null = null

  return {
    async resolve() {
      if (cached)
        return cached

      const key = apiKey || process.env.COHERE_API_KEY
      if (!key)
        throw new Error('Cohere API key required: pass apiKey or set COHERE_API_KEY env')

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
          throw new Error(`Cohere rerank failed (${res.status}): ${body}`)
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

export default cohereReranker
