/**
 * Embedding provider types
 */
export type EmbeddingPreset
  = | 'openai'
    | 'google'
    | 'mistral'
    | 'cohere'
    | 'ollama'
    | 'transformers.js'

/**
 * Default models per provider
 */
export const DEFAULT_MODELS: Record<EmbeddingPreset, { model: string, dimensions: number }> = {
  'openai': { model: 'text-embedding-3-small', dimensions: 1536 },
  'google': { model: 'text-embedding-004', dimensions: 768 },
  'mistral': { model: 'mistral-embed', dimensions: 1024 },
  'cohere': { model: 'embed-english-v3.0', dimensions: 1024 },
  'ollama': { model: 'nomic-embed-text', dimensions: 768 },
  'transformers.js': { model: 'Xenova/bge-small-en-v1.5', dimensions: 384 },
}

/**
 * Known dimensions for common models
 */
export const MODEL_DIMENSIONS: Record<string, number> = {
  // OpenAI
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  // Google
  'text-embedding-004': 768,
  'embedding-001': 768,
  // Mistral
  'mistral-embed': 1024,
  // Cohere
  'embed-english-v3.0': 1024,
  'embed-multilingual-v3.0': 1024,
  'embed-english-light-v3.0': 384,
  'embed-multilingual-light-v3.0': 384,
  // Ollama / local
  'nomic-embed-text': 768,
  'mxbai-embed-large': 1024,
  'all-minilm': 384,
  'snowflake-arctic-embed': 1024,
  // BGE family
  'bge-small-en-v1.5': 384,
  'bge-base-en-v1.5': 768,
  'bge-large-en-v1.5': 1024,
  'bge-m3': 1024,
  // Other common
  'all-MiniLM-L6-v2': 384,
  'embeddinggemma-300m': 256,
  'plamo-embedding-1b': 1024,
}

/**
 * Get dimensions for a model (returns undefined if unknown)
 */
export function getModelDimensions(model: string): number | undefined {
  // Direct lookup
  if (MODEL_DIMENSIONS[model])
    return MODEL_DIMENSIONS[model]

  // Strip common prefixes (Xenova/, onnx-community/, etc)
  const normalized = model.replace(/^(Xenova\/|onnx-community\/)/, '')
  return MODEL_DIMENSIONS[normalized]
}

/**
 * Model name mappings for transformers.js
 */
const MODEL_MAPPINGS: Record<string, Record<string, string>> = {
  'transformers.js': {
    'bge-base-en-v1.5': 'Xenova/bge-base-en-v1.5',
    'bge-large-en-v1.5': 'onnx-community/bge-large-en-v1.5',
    'bge-small-en-v1.5': 'Xenova/bge-small-en-v1.5',
    'bge-m3': 'Xenova/bge-m3',
    'all-MiniLM-L6-v2': 'Xenova/all-MiniLM-L6-v2',
    'embeddinggemma-300m': 'onnx-community/embeddinggemma-300m-ONNX',
  },
}

/**
 * Resolve model name for a specific preset
 */
export function resolveModelForPreset(model: string, preset: string): string {
  return MODEL_MAPPINGS[preset]?.[model] ?? model
}
