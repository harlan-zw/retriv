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
  lineRange?: [number, number]
  /** Entities defined in this chunk */
  entities?: ChunkEntity[]
  /** Scope chain for this chunk */
  scope?: ChunkEntity[]
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
 * Filter operator for metadata queries
 */
export type FilterOperator
  = | { $eq: string | number | boolean }
    | { $ne: string | number | boolean }
    | { $gt: number }
    | { $gte: number }
    | { $lt: number }
    | { $lte: number }
    | { $in: (string | number)[] }
    | { $prefix: string }
    | { $exists: boolean }

/**
 * Filter value — either exact match or operator
 */
export type FilterValue = string | number | boolean | FilterOperator

/**
 * Metadata filter — keys are metadata field names, values are match conditions.
 * Multiple keys = AND.
 */
export type SearchFilter = Record<string, FilterValue>

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
  /** Filter results by metadata fields */
  filter?: SearchFilter
}

/**
 * Progress phases during indexing
 */
export type IndexPhase = 'chunking' | 'embedding' | 'storing'

/**
 * Progress info emitted during indexing
 */
export interface IndexProgress {
  phase: IndexPhase
  current: number
  total: number
}

/**
 * Options for the index operation
 */
export interface IndexOptions {
  /** Called with progress updates during indexing */
  onProgress?: (progress: IndexProgress) => void
}

/**
 * Search provider interface - unified across all driver types
 */
export interface SearchProvider {
  /**
   * Index documents for search
   */
  index: (docs: Document[], options?: IndexOptions) => Promise<{ count: number }>

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
// Reranker types
// ============================================

/**
 * Reranker function — re-scores and reorders search results
 */
export type Reranker = (query: string, results: SearchResult[]) => Promise<SearchResult[]>

/**
 * Reranker config (returned by reranker modules)
 */
export interface RerankerConfig {
  /** Resolve the reranker function (lazy-loaded, cached) */
  resolve: () => Promise<Reranker>
}

// ============================================
// Embedding types
// ============================================

/**
 * A single embedding vector — either a plain array or a typed array
 */
export type Embedding = number[] | Float32Array

/**
 * Embedding provider function
 * Takes text(s) and returns embedding vectors
 */
export type EmbeddingProvider = (texts: string[]) => Promise<Embedding[]>

/**
 * Resolved embedding result
 */
export interface ResolvedEmbedding {
  embedder: EmbeddingProvider
  dimensions: number
  maxTokens?: number
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
 * Entity info extracted from AST-aware chunking
 */
export interface ChunkEntity {
  name: string
  type: string
  signature?: string
  isPartial?: boolean
}

/**
 * Import info extracted from AST-aware chunking
 */
export interface ChunkImport {
  name: string
  source: string
  isDefault?: boolean
  isNamespace?: boolean
}

/**
 * Sibling entity info for context around a chunk
 */
export interface ChunkSibling {
  name: string
  type: string
  position: 'before' | 'after'
  distance: number
}

/**
 * A chunk produced by a chunker function
 */
export interface ChunkerChunk {
  text: string
  /** Character range [start, end] in original content */
  range?: [number, number]
  /** Line range [start, end] in original content */
  lineRange?: [number, number]
  /** Optional context to prepend for embedding (file path, scope, imports) */
  context?: string
  /** Entities defined in this chunk (functions, classes, methods, etc.) */
  entities?: ChunkEntity[]
  /** Scope chain from innermost to outermost containing entity */
  scope?: ChunkEntity[]
  /** Imports referenced by this chunk */
  imports?: ChunkImport[]
  /** Sibling entities before/after this chunk */
  siblings?: ChunkSibling[]
}

/**
 * Chunker function — takes content + optional metadata, returns chunks
 */
export type Chunker = (content: string, meta?: { id?: string, metadata?: Record<string, any> }) => ChunkerChunk[] | Promise<ChunkerChunk[]>

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
 * Categorize function — derives a category name from a document.
 * Used by split-category search to auto-tag documents at index time.
 */
export type Categorizer = (doc: Document) => string

/**
 * Options for createRetriv factory
 */
export interface RetrivOptions {
  driver: DriverInput
  /** Chunker function from retriv/chunkers/ */
  chunking?: Chunker
  /** Reranker to apply after fusion */
  rerank?: RerankerConfig
  /**
   * Categorize function for split-category search.
   * Documents are auto-tagged with `metadata.category` at index time.
   * Search fans out per-category and fuses with RRF.
   */
  categories?: Categorizer
}
