export type AISDKProvider = 'openai' | 'google' | 'mistral' | 'cohere' | 'anthropic' | 'ollama' | 'transformers.js' | 'workers-ai' | 'vercel-gateway'

export interface ProviderConfig {
  apiKey?: string
  baseURL?: string
  model?: string
  dimensions?: number
}

export interface ProviderPreset {
  preset: AISDKProvider
  apiKey?: string
  baseUrl?: string
}

/**
 * Normalize provider config from preset + env fallbacks
 */
export function normalizeProviderConfig(preset: ProviderPreset): ProviderConfig {
  const provider = preset.preset

  // Handle Vercel Gateway token (use VERCEL_AI_GATEWAY_TOKEN env var)
  let apiKey: string | undefined
  if (provider === 'vercel-gateway') {
    apiKey = preset.apiKey || process.env.VERCEL_AI_GATEWAY_TOKEN
  }
  else {
    apiKey = preset.apiKey || process.env[`${provider.toUpperCase()}_API_KEY`]
  }

  // For Ollama, add /api suffix if baseUrl is just the host
  let baseURL = preset.baseUrl
  if (!baseURL && provider === 'ollama') {
    const ollamaBase = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
    baseURL = ollamaBase.endsWith('/api') ? ollamaBase : `${ollamaBase}/api`
  }

  return { apiKey, baseURL }
}

/**
 * Default models per provider (AI SDK doesn't expose these)
 */
export const DEFAULT_MODELS: Record<AISDKProvider, { model: string, maxDimensions: number }> = {
  'openai': { model: 'text-embedding-3-small', maxDimensions: 1536 },
  'google': { model: 'text-embedding-004', maxDimensions: 768 },
  'mistral': { model: 'mistral-embed', maxDimensions: 1024 },
  'cohere': { model: 'embed-english-v3.0', maxDimensions: 1024 },
  'anthropic': { model: 'voyage-2', maxDimensions: 1024 },
  'ollama': { model: 'nomic-embed-text', maxDimensions: 768 },
  'transformers.js': { model: 'Xenova/bge-base-en-v1.5', maxDimensions: 768 },
  'workers-ai': { model: '@cf/baai/bge-base-en-v1.5', maxDimensions: 768 },
  'vercel-gateway': { model: 'text-embedding-3-small', maxDimensions: 1536 },
}

/**
 * Default dimensions for common models
 */
export const MODEL_DIMENSIONS: Record<string, number> = {
  'bge-small-en-v1.5': 384,
  'bge-base-en-v1.5': 768,
  'bge-large-en-v1.5': 1024,
  'bge-m3': 1024,
  'all-MiniLM-L6-v2': 384,
  'embeddinggemma-300m': 256,
  'plamo-embedding-1b': 1024,
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-004': 768,
  'mistral-embed': 1024,
  'embed-english-v3.0': 1024,
  'nomic-embed-text': 768,
}

/**
 * Get dimension size for a model (returns undefined if unknown)
 */
export function getModelDimensions(baseModel: string): number | undefined {
  // Strip common prefixes (Xenova/, onnx-community/, @cf/, etc)
  const normalizedModel = baseModel.replace(/^(Xenova\/|onnx-community\/|@cf\/[^/]+\/)/, '')
  return MODEL_DIMENSIONS[normalizedModel]
}

/**
 * Model name mappings for different presets
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
  'workers-ai': {
    'bge-base-en-v1.5': '@cf/baai/bge-base-en-v1.5',
    'bge-large-en-v1.5': '@cf/baai/bge-large-en-v1.5',
    'bge-small-en-v1.5': '@cf/baai/bge-small-en-v1.5',
    'bge-m3': '@cf/baai/bge-m3',
    'embeddinggemma-300m': '@cf/google/embeddinggemma-300m',
    'plamo-embedding-1b': '@cf/pfnet/plamo-embedding-1b',
  },
}

/**
 * Resolve model name for a specific preset
 * Maps generic model names to provider-specific names
 */
export function resolveModelForPreset(baseModel: string, preset: string): string {
  const presetMappings = MODEL_MAPPINGS[preset]
  if (!presetMappings)
    return baseModel // No mapping needed, use as-is

  return presetMappings[baseModel] || baseModel // Use mapping or fallback to base
}

/**
 * Check if model is a pure reasoning model (no temperature support)
 * These models use chain-of-thought internally and don't support temperature param
 * Note: Hybrid models (qwen3, deepseek-r1) support both thinking AND temperature
 */
export function isReasoningModel(modelName: string): boolean {
  const model = modelName.toLowerCase()
  // Only pure reasoning models that don't support temperature
  // Hybrid models (qwen3, deepseek-r1, magistral) support temperature
  const pureReasoningModels = [
    /^o1/i, // OpenAI o1, o1-mini, o1-preview
    /^o3/i, // OpenAI o3
  ]
  return pureReasoningModels.some(p => p.test(model))
}

/**
 * Check if model supports tool/function calling
 * Based on Ollama's tool support list and cloud provider capabilities
 * Note: Some reasoning models (qwen3, deepseek-r1) support BOTH thinking and tools
 */
export function supportsTools(modelName: string): boolean {
  const model = modelName.toLowerCase()

  // Cloud providers - all support tools
  if (/^(?:gpt|claude|gemini|command)/.test(model))
    return true

  // Ollama models with tool support (from Ollama docs)
  // Includes hybrid reasoning+tools models: qwen3, deepseek-r1, magistral, gpt-oss
  const toolSupportingFamilies = [
    /^llama3\.[123]/i, // llama3.1, llama3.2, llama3.3
    /^llama-3\.[123]/i, // llama-3.1, llama-3.2, llama-3.3
    /^qwen2\.5/i, // qwen2.5
    /^qwen3/i, // qwen3 (hybrid: tools + thinking)
    /^qwq/i, // QwQ (reasoning with tools)
    /^deepseek-r1/i, // DeepSeek R1 (hybrid: tools + thinking)
    /^deepseek-v3/i, // DeepSeek V3 (hybrid)
    /^magistral/i, // Magistral (hybrid: tools + thinking)
    /^gpt-oss/i, // GPT-OSS (hybrid: tools + thinking)
    /^mistral(?!-embed)/i, // mistral (not mistral-embed)
    /^mistral-small/i,
    /^mistral-large/i,
    /^mistral-nemo/i,
    /^mixtral/i,
    /^codestral/i,
    /^command-r/i,
    /^command-a/i,
    /^hermes3/i,
    /^athene-v2/i,
    /^nemotron/i,
    /^granite3/i,
    /^granite-3/i,
    /^granite3-dense/i,
    /^granite3-moe/i,
    /^smollm2/i,
    /^llama3-groq/i,
    /^llama-3\.2-vision/i,
    /^llama-3\.2-11b-vision/i,
    /^llama-3\.2-90b-vision/i,
    /^llama3\.2-vision/i,
    /^phi4/i,
    /^devstral/i,
  ]

  if (toolSupportingFamilies.some(p => p.test(model)))
    return true

  // Explicitly no tool support (from Ollama docs or known)
  const noToolSupport = [
    /^gemma/i, // gemma variants
    /^phi[123]/i, // phi, phi2, phi3 (phi4 supports)
    /^tinyllama/i,
    /^starcoder/i,
    /^codellama/i,
    /^llama2/i, // llama 2 doesn't support
    /^llama3(?!\.[123])/i, // llama3 without version doesn't support
    /^o1/i, // OpenAI o1 (reasoning only, no tools)
    /^o3/i, // OpenAI o3 (reasoning only, no tools)
  ]

  if (noToolSupport.some(p => p.test(model)))
    return false

  // Unknown - default false for safety (tools error otherwise)
  return false
}

/**
 * Check if model supports query rewriting
 * Small models (<7B params) tend to hallucinate or ignore instructions
 */
export function supportsQueryRewriting(modelName: string): boolean {
  const model = modelName.toLowerCase()

  // Known problematic models
  const tooSmall = [
    // Gemma small variants
    /gemma[:\-]?(3|2)?:?1b/i, // gemma3:1b, gemma:1b, gemma-1b
    /gemma[:\-]?(3|2)?:?2b/i, // gemma3:2b, gemma:2b, gemma-2b

    // Llama small variants
    /llama[:\-]?3[:\-]?1b/i,
    /llama[:\-]?3\.?2[:\-]?1b/i,

    // Qwen small
    /qwen[:\-]?2\.?5?[:\-]?(0\.5|1|3)b/i,

    // Phi small
    /phi[:\-]?[123][:\-]?(mini|3b)/i,

    // TinyLlama
    /tinyllama/i,

    // Generic small markers (1-6b range)
    /[\-:][0-6]b[\-:]?/i, // Matches :1b, -2b, :3b etc (not 7b+)
    /[\-:]0\.\db/i, // Matches 0.5b etc
  ]

  if (tooSmall.some(pattern => pattern.test(model))) {
    return false
  }

  // Cloud providers generally use large models
  const cloudProviders = ['gpt', 'claude', 'gemini', 'mistral-large', 'command']
  if (cloudProviders.some(provider => model.includes(provider))) {
    return true
  }

  // Default: assume model is capable if ≥7B or unknown
  // Extract size if present (e.g., "7b", "13b")
  const sizeMatch = model.match(/(\d+)b/)
  if (sizeMatch?.[1]) {
    const size = Number.parseInt(sizeMatch[1])
    return size >= 7
  }

  // Unknown model, assume capable (opt-in behavior)
  return true
}
