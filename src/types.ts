/**
 * A document to be indexed for search
 */
export interface Document {
  /** Unique identifier */
  id: string
  /** Text content to search */
  content: string
  /** Optional metadata to store alongside */
  metadata?: Record<string, any>
}

/**
 * Chunk info when chunking is enabled
 */
export interface ChunkInfo {
  parentId: string
  index: number
  range?: [number, number]
}

/**
 * Driver-specific metadata
 */
export interface SearchMeta {
  bm25Score?: number
  highlights?: string[]
  distance?: number
  vector?: number[]
  matches?: Array<{ indices: [number, number][], value: string }>
  [key: string]: any
}

/**
 * A search result
 */
export interface SearchResult {
  /** Document ID */
  id: string
  /** Relevance score (0-1, higher is better) */
  score: number
  /** Original content (if returnContent: true) */
  content?: string
  /** Document metadata (if returnMetadata: true) */
  metadata?: Record<string, any>
  /** Chunk info (when chunking enabled) */
  _chunk?: ChunkInfo
  /** Driver-specific extras (if returnMeta: true) */
  _meta?: SearchMeta
}

/**
 * Search options
 */
export interface SearchOptions {
  /** Maximum results to return */
  limit?: number
  /** Return original content */
  returnContent?: boolean
  /** Return metadata */
  returnMetadata?: boolean
  /** Return driver-specific _meta */
  returnMeta?: boolean
}

/**
 * Search provider interface - unified across all driver types
 */
export interface SearchProvider {
  /**
   * Index documents for search
   */
  index: (docs: Document[]) => Promise<{ count: number }>

  /**
   * Search for documents
   */
  search: (query: string, options?: SearchOptions) => Promise<SearchResult[]>

  /**
   * Remove documents by ID
   */
  remove?: (ids: string[]) => Promise<{ count: number }>

  /**
   * Clear all indexed documents
   */
  clear?: () => Promise<void>

  /**
   * Close the provider and release resources
   */
  close?: () => Promise<void>
}

/**
 * Base config shared by all drivers
 */
export interface BaseDriverConfig {
  /** Database/index path or URL */
  path?: string
  url?: string
}

// ============================================
// Embedding types
// ============================================

/**
 * Embedding provider function
 * Takes text(s) and returns embedding vectors
 */
export type EmbeddingProvider = (texts: string[]) => Promise<number[][]>

/**
 * Resolved embedding result
 */
export interface ResolvedEmbedding {
  embedder: EmbeddingProvider
  dimensions: number
}

/**
 * Embedding config (returned by embedding modules)
 */
export interface EmbeddingConfig {
  /** Resolve the embedding provider */
  resolve: () => Promise<ResolvedEmbedding>
}

// ============================================
// Vector-specific types (Cloudflare Vectorize-compatible)
// ============================================

export type VectorFloatArray = Float32Array | Float64Array
export type VectorizeVectorMetadata = string | number | boolean | string[]

export interface VectorizeVector {
  id: string
  values: VectorFloatArray | number[]
  namespace?: string
  metadata?: Record<string, VectorizeVectorMetadata>
}

export interface VectorizeMatch {
  id: string
  score: number
  values?: number[]
  namespace?: string
  metadata?: Record<string, VectorizeVectorMetadata>
}

export interface VectorizeMatches {
  matches: VectorizeMatch[]
  count: number
}

export interface VectorizeQueryOptions {
  topK?: number
  namespace?: string
  returnValues?: boolean
  returnMetadata?: boolean
  filter?: Record<string, any>
}

/**
 * Semantic driver config (vector-based search)
 */
export interface SemanticDriverConfig extends BaseDriverConfig {
  /** Embedding provider from retriv/embeddings/ */
  embeddings: EmbeddingConfig
  /** Auth token for remote databases */
  authToken?: string
  /** Namespace for vector isolation */
  namespace?: string
  /** Distance metric */
  metric?: 'cosine' | 'euclidean' | 'dot-product'
}

/**
 * Text-native driver config (e.g., Upstash - handles embeddings server-side)
 */
export interface TextNativeDriverConfig extends BaseDriverConfig {
  /** API token */
  token: string
  /** Namespace for isolation */
  namespace?: string
}

/**
 * A chunk produced by a chunker function
 */
export interface ChunkerChunk {
  text: string
  /** Character range [start, end] in original content */
  range?: [number, number]
  /** Optional context to prepend for embedding (file path, scope, imports) */
  context?: string
}

/**
 * Chunker function — takes content + optional metadata, returns chunks
 */
export type Chunker = (content: string, meta?: { id?: string, metadata?: Record<string, any> }) => ChunkerChunk[] | Promise<ChunkerChunk[]>

/**
 * Chunking configuration
 */
export interface ChunkingOptions {
  chunkSize?: number
  chunkOverlap?: number
  /** Custom chunker function. Defaults to markdown-aware splitText. */
  chunker?: Chunker
}

/**
 * Resolvable driver (can be promise)
 */
type Resolvable<T> = T | Promise<T>

/**
 * Any search provider (for composed drivers - loosened for driver compatibility)
 */
type AnyDriver = Resolvable<SearchProvider>

/**
 * Composed driver config for hybrid search
 */
export interface ComposedDriver {
  vector?: AnyDriver
  keyword?: AnyDriver
}

/**
 * Driver input - single driver or composed
 */
export type DriverInput = AnyDriver | ComposedDriver

/**
 * Options for createRetriv factory
 */
export interface RetrivOptions {
  driver: DriverInput
  chunking?: ChunkingOptions
}
