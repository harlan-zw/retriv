import type { Reranker, SearchResult } from '../types'

export interface CrossEncoderConfig {
  /** Model name (default: 'Xenova/ms-marco-MiniLM-L-6-v2') */
  model?: string
}

/**
 * Create a cross-encoder reranker using transformers.js
 */
export async function crossEncoder(config: CrossEncoderConfig = {}): Promise<Reranker> {
  const { model = 'Xenova/ms-marco-MiniLM-L-6-v2' } = config
  const { AutoTokenizer, AutoModelForSequenceClassification } = await import('@huggingface/transformers')

  const tokenizer = await AutoTokenizer.from_pretrained(model)
  const ceModel = await AutoModelForSequenceClassification.from_pretrained(model)

  return async (query: string, results: SearchResult[]): Promise<SearchResult[]> => {
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
}

export default crossEncoder
