// Cloudflare Vectorize-compatible types
export type VectorFloatArray = Float32Array | Float64Array
export type VectorizeVectorMetadata = string | number | boolean | string[]

export interface VectorizeVector {
  /** The ID for the vector. This can be user-defined, and must be unique. */
  id: string
  /** The vector values */
  values: VectorFloatArray | number[]
  /** The namespace this vector belongs to. */
  namespace?: string
  /** Metadata associated with the vector. */
  metadata?: Record<string, VectorizeVectorMetadata>
}

export interface VectorizeMatch {
  /** The vector ID */
  id: string
  /** The score or rank for similarity */
  score: number
  /** The vector values (if returnValues: true) */
  values?: number[]
  /** The namespace this vector belongs to */
  namespace?: string
  /** Metadata associated with the vector (if returnMetadata: true) */
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

export interface VectorDbProvider {
  /**
   * Query mode: 'text' for text-native drivers (Upstash), 'vector' for vector-based drivers
   */
  mode: 'text' | 'vector'

  /**
   * Query for similar vectors using vector similarity
   */
  query: (vector: VectorFloatArray | number[], options?: VectorizeQueryOptions) => Promise<VectorizeMatches>

  /**
   * Insert vectors into the index. Fails if IDs already exist.
   */
  insert: (vectors: VectorizeVector[]) => Promise<{ ids: string[], count: number }>

  /**
   * Upsert vectors into the index. Creates or updates.
   */
  upsert: (vectors: VectorizeVector[]) => Promise<{ ids: string[], count: number }>

  /**
   * Get all vectors from the index (for dump/export)
   * Optional - not all providers support this
   */
  getAll?: () => Promise<VectorizeVector[]>

  /**
   * Close the storage connection
   */
  close?: () => Promise<void>

  /**
   * Vector dimensions
   */
  dimensions: number
}

export interface DriverConfig {
  dimensions: number
  path?: string
  url?: string
  authToken?: string
  token?: string
  namespace?: string
  metric?: 'cosine' | 'euclidean' | 'dot-product'
}
