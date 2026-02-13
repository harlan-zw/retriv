import type { Embedding, EmbeddingProvider, IndexProgress } from '../types'

const MAX_BATCH_ITEMS = 64
const CHARS_PER_TOKEN = 4
// Target compute per batch: 64 items * 128 tokens — keeps batches
// roughly equal cost regardless of text length
const TARGET_BATCH_TOKENS = MAX_BATCH_ITEMS * 128

/**
 * Embed texts in batches, reporting progress between each batch.
 *
 * Sorts texts by length so similarly-sized texts are grouped, minimizing
 * padding waste in transformer models. Batch sizes adapt to text length:
 * short texts get large batches, long texts get small batches, targeting
 * a consistent compute budget per batch. Results are returned in the
 * original input order.
 */
export async function embedBatch(
  embedder: EmbeddingProvider,
  texts: string[],
  onProgress?: (progress: IndexProgress) => void,
): Promise<Embedding[]> {
  const total = texts.length
  onProgress?.({ phase: 'embedding', current: 0, total })

  if (total === 0)
    return []

  // Sort indices by text length so similar-length texts batch together
  const indices = Array.from({ length: total }, (_, i) => i)
  indices.sort((a, b) => texts[a]!.length - texts[b]!.length)

  const results: Embedding[] = Array.from<Embedding>({ length: total })
  let processed = 0

  while (processed < total) {
    // Estimate tokens for the longest text in this window (last in sorted order)
    // to determine adaptive batch size
    const longestIdx = indices[Math.min(processed + MAX_BATCH_ITEMS - 1, total - 1)]!
    const estTokens = Math.max(1, Math.ceil(texts[longestIdx]!.length / CHARS_PER_TOKEN))
    const batchSize = Math.min(MAX_BATCH_ITEMS, total - processed, Math.max(1, Math.floor(TARGET_BATCH_TOKENS / estTokens)))

    const batchIndices = indices.slice(processed, processed + batchSize)
    const batch = batchIndices.map(idx => texts[idx]!)
    const embeddings = await embedder(batch)
    for (let j = 0; j < batchIndices.length; j++)
      results[batchIndices[j]!] = embeddings[j]!

    processed += batchSize
    onProgress?.({ phase: 'embedding', current: processed, total })
  }

  return results
}
