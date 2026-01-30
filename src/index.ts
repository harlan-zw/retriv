// Types
export type {
  DriverConfig,
  VectorDbProvider,
  VectorFloatArray,
  VectorizeMatch,
  VectorizeMatches,
  VectorizeQueryOptions,
  VectorizeVector,
  VectorizeVectorMetadata,
} from './types'

// Adapter
export type { EmbedderAdapter, EmbedderAdapterConfig } from './adapter'
export { createAdapter } from './adapter'

// Model utilities
export type { AISDKProvider, ProviderConfig, ProviderPreset } from './model'
export {
  DEFAULT_MODELS,
  getModelDimensions,
  isReasoningModel,
  MODEL_DIMENSIONS,
  normalizeProviderConfig,
  resolveModelForPreset,
  supportsQueryRewriting,
  supportsTools,
} from './model'
