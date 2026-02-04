import type { Reranker, RerankerConfig, SearchResult } from '../types'

/** Well-known cross-encoder models compatible with transformers.js */
export type CrossEncoderModel
  = | 'Xenova/ms-marco-MiniLM-L-6-v2'
    | 'Xenova/ms-marco-MiniLM-L-12-v2'
    | 'mixedbread-ai/mxbai-rerank-xsmall-v1'
    | 'mixedbread-ai/mxbai-rerank-base-v1'
    | 'Xenova/bge-reranker-base'
    | 'Xenova/bge-reranker-large'
    | (string & {})

export interface CrossEncoderConfig {
  /** Cross-encoder model name */
  model?: CrossEncoderModel
}

export function crossEncoder(config: CrossEncoderConfig = {}): RerankerConfig {
  const { model = 'Xenova/ms-marco-MiniLM-L-6-v2' } = config
  let cached: Reranker | null = null

  return {
    async resolve() {
      if (cached)
        return cached

      const { AutoTokenizer, AutoModelForSequenceClassification } = await import('@huggingface/transformers')

      const tokenizer = await AutoTokenizer.from_pretrained(model)
      const ceModel = await AutoModelForSequenceClassification.from_pretrained(model)

      cached = async (query: string, results: SearchResult[]): Promise<SearchResult[]> => {
        if (results.length === 0)
          return results

        const withContent = results.filter(r => r.content)
        const withoutContent = results.filter(r => !r.content)

        if (withContent.length === 0)
          return results

        const scored = await Promise.all(withContent.map(async (result) => {
          const inputs = await tokenizer(query, result.content, {
            padding: true,
            truncation: true,
            max_length: 512,
          })
          const output = await ceModel(inputs)
          const logit = output.logits.data[0]
          const score = 1 / (1 + Math.exp(-logit))
          return { ...result, score }
        }))

        scored.sort((a, b) => b.score - a.score)
        return [...scored, ...withoutContent]
      }

      return cached
    },
  }
}

export default crossEncoder
