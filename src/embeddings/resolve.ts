import type { EmbeddingConfig, ResolvedEmbedding } from '../types'

/**
 * Resolve an EmbeddingConfig to an embedder and dimensions
 * Simply calls the resolve method on the config
 */
export async function resolveEmbedding(config: EmbeddingConfig): Promise<ResolvedEmbedding> {
  return config.resolve()
}
