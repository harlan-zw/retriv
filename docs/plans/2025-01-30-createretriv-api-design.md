# createRetriv API Design

## Overview

Unified document retrieval API inspired by unstorage's driver pattern. Single `createRetriv` factory accepts any driver (FTS, fuzzy, vector) and provides consistent interface.

## Core API

```ts
import { createRetriv } from 'retriv'
import { sqliteFts } from 'retriv/fts/sqlite'
import { sqliteVec } from 'retriv/vector/sqlite-vec'

// FTS driver
const retriv = await createRetriv({
  driver: sqliteFts({ path: './search.db' })
})

// Vector driver (embedding model in driver config)
const retriv = await createRetriv({
  driver: sqliteVec({
    path: './vectors.db',
    dimensions: 1536,
    embeddingModel: openai.embedding('text-embedding-3-small')
  })
})

// Unified interface
await retriv.index([{ id: '1', content: 'hello world', metadata: { source: 'test' } }])
const results = await retriv.search('hello', { limit: 10 })
await retriv.remove(['1'])
await retriv.clear()
await retriv.close()
```

## Types

### Document (input)

```ts
interface Document {
  id: string
  content: string
  metadata?: Record<string, any>
}
```

### SearchResult (output)

```ts
interface SearchResult {
  // Core (always present)
  id: string
  score: number // 0-1, normalized across all drivers

  // Optional content
  content?: string
  metadata?: Record<string, any>

  // Chunk info (when chunking enabled)
  _chunk?: {
    parentId: string
    index: number
    range?: [number, number] // char offsets in original
  }

  // Driver-specific extras
  _meta?: {
    bm25Score?: number // FTS
    highlights?: string[] // FTS
    distance?: number // Vector
    vector?: number[] // Vector
    matches?: Array<{ indices: [number, number][], value: string }> // Fuzzy
    [key: string]: any
  }
}
```

### SearchOptions

```ts
interface SearchOptions {
  limit?: number
  returnContent?: boolean
  returnMetadata?: boolean
  returnMeta?: boolean // Include _meta
  filter?: Record<string, any>
}
```

### RetrivOptions

```ts
interface RetrivOptions {
  driver: SearchProvider | Promise<SearchProvider>
  chunking?: {
    chunkSize?: number // default 1000
    chunkOverlap?: number // default 200
  }
}
```

## Built-in Chunking

Uses LangChain-style recursive markdown splitting internally.

Separators (priority order):
```ts
[
  '\n## ',
  '\n### ',
  '\n#### ',
  '\n##### ',
  '\n###### ', // headings
  '```\n\n', // code blocks
  '\n\n***\n\n',
  '\n\n---\n\n',
  '\n\n___\n\n', // horizontal rules
  '\n\n', // paragraphs
  '\n', // lines
  ' ', // words
  '' // chars (fallback)
]
```

Logic:
1. Find first separator present in text
2. Split on it, process each piece
3. If piece > chunkSize, recurse with remaining separators
4. Merge small pieces respecting overlap

Chunk IDs: `{parentId}#chunk-{index}`

## Driver Interface

Drivers implement `SearchProvider`:

```ts
interface SearchProvider {
  mode: 'semantic' | 'fulltext' | 'fuzzy' | 'hybrid'
  index: (docs: Document[]) => Promise<{ count: number }>
  search: (query: string, options?: SearchOptions) => Promise<SearchResult[]>
  remove?: (ids: string[]) => Promise<{ count: number }>
  clear?: () => Promise<void>
  close?: () => Promise<void>
}
```

Driver factories:
```ts
// Sync drivers
export function sqliteFts(config: SqliteFtsConfig): SearchProvider
export function fuse(config: FuseConfig): SearchProvider
export function minisearch(config: MinisearchConfig): SearchProvider

// Async drivers (need embedding model setup)
export function sqliteVec(config: SqliteVecConfig): Promise<SearchProvider>
export function libsql(config: LibsqlConfig): Promise<SearchProvider>
export function upstash(config: UpstashConfig): Promise<SearchProvider>
export function pgvector(config: PgvectorConfig): Promise<SearchProvider>
export function cloudflare(config: CloudflareConfig): Promise<SearchProvider>
```

Vector driver configs include `embeddingModel` - driver handles embedding internally.

## Implementation Tasks

1. Add `splitText()` internal utility (recursive markdown splitter)
2. Create `createRetriv()` factory with chunking wrapper
3. Update vector drivers to accept `embeddingModel` in config (move from adapter)
4. Remove `createSemanticAdapter` (logic moves into drivers)
5. Update exports in index.ts
6. Add tests for chunking + unified API
