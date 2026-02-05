<h1>retriv</h1>

[![npm version](https://img.shields.io/npm/v/retriv?color=yellow)](https://npmjs.com/package/retriv)
[![npm downloads](https://img.shields.io/npm/dm/retriv?color=yellow)](https://npm.chart.dev/retriv)
[![license](https://img.shields.io/github/license/harlan-zw/retriv?color=yellow)](https://github.com/harlan-zw/retriv/blob/main/LICENSE)

> Hybrid search for TypeScript/JavaScript projects. AST-aware chunking, camelCase tokenization, local-first with optional cloud backends.

## Why?

Building search for TS/JS codebases is harder than it looks:

- **Keyword search** misses semantic matches — "authentication" won't find `verifyCredentials()`
- **Vector search** misses exact identifiers — `getUserName` returns fuzzy matches instead of the function
- **Generic chunkers** break code mid-function — you need AST-aware splitting that understands TS/JS syntax

**retriv is purpose-built for the JS ecosystem:** TypeScript compiler API for AST parsing (zero native deps), automatic `camelCase`/`snake_case` tokenization, hybrid BM25+vector search with [RRF fusion](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf). Start with SQLite, scale to Turso/Upstash/Cloudflare when needed.

<p align="center">
<table>
<tbody>
<td align="center">
<sub>Made possible by my <a href="https://github.com/sponsors/harlan-zw">Sponsor Program 💖</a><br> Follow me <a href="https://twitter.com/harlan_zw">@harlan_zw</a> 🐦 • Join <a href="https://discord.gg/275MBUBvgP">Discord</a> for help</sub><br>
</td>
</tbody>
</table>
</p>

## Features

- 🎯 **Hybrid search** — BM25 keywords + vector semantic, merged via [RRF](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf)
- 🌳 **TS/JS AST chunking** — TypeScript compiler API splits on function/class boundaries, extracts signatures and scope (zero native deps)
- 🔤 **Code-aware tokenization** — `getUserName` → `get User Name getUserName` for better BM25 recall
- 📦 **Local to cloud** — start with SQLite, scale to Turso/Upstash/Cloudflare
- 🔍 **Metadata filtering** — narrow by file type, path prefix, or custom fields

## Installation

```bash
pnpm add retriv
```

## Quick Start - Local Hybrid Search

1. Install extra dependencies:

```bash
# sqlite-vec for vector storage, transformers for local embeddings
pnpm add sqlite-vec @huggingface/transformers
```

2. Create your retriv search instance:

```ts
import { createRetriv } from 'retriv'
import { autoChunker } from 'retriv/chunkers/auto'
import sqlite from 'retriv/db/sqlite'
import { transformersJs } from 'retriv/embeddings/transformers-js'

const search = await createRetriv({
  driver: sqlite({
    path: './search.db',
    embeddings: transformersJs(),
  }),
  chunking: autoChunker(), // TS/JS AST + markdown splitting
})
```

3. Index documents:

```ts
await search.index([
  { id: 'src/auth.ts', content: authFileContents, metadata: { type: 'code', lang: 'typescript' } },
  { id: 'docs/guide.md', content: guideContents, metadata: { type: 'docs' } },
])
```

4. Search!
```ts
// hybrid search finds both code and docs
const results = await search.search('password hashing', { returnContent: true })
// [
//   {
//     id: 'src/auth.ts#chunk-2', score: 0.82,
//     content: 'async function hashPassword(raw: string) {\n  ...',
//     _chunk: {
//       parentId: 'src/auth.ts', index: 2,
//       range: [140, 312], lineRange: [12, 28],
//       entities: [{ name: 'hashPassword', type: 'function' }],
//       scope: [{ name: 'AuthService', type: 'class' }],
//     },
//   },
//   {
//     id: 'docs/guide.md#chunk-0', score: 0.71,
//     content: '## Password Hashing\n\nUse bcrypt with...',
//     _chunk: { parentId: 'docs/guide.md', index: 0, range: [0, 487] },
//   },
// ]

// filter to just code files
await search.search('getUserName', { filter: { type: 'code' } })
// [
//   { id: 'src/auth.ts#chunk-0', score: 0.91, _chunk: { parentId: 'src/auth.ts', index: 0, range: [0, 139] } },
// ]
```

### Split-Category Search

When one category of documents (e.g. prose docs) outnumbers another (e.g. code definitions), the majority can drown out minority results. Split-category search fixes this by running parallel filtered searches per category and fusing with RRF — each category gets equal representation regardless of volume.

```ts
const search = await createRetriv({
  driver: sqlite({ path: './search.db', embeddings: transformersJs() }),
  categories: doc => doc.metadata?.type || 'other',
})

await search.index([
  { id: 'src/auth.ts', content: authCode, metadata: { type: 'code' } },
  { id: 'docs/guide.md', content: guide, metadata: { type: 'docs' } },
  { id: 'docs/api.md', content: apiRef, metadata: { type: 'docs' } },
])

// Code results won't be buried by docs, even when outnumbered
await search.search('authentication')
```

The `categories` function receives each document at index time and returns a category string. The category is stored in `metadata.category` automatically. At search time, one query runs per seen category and results are fused with RRF.

Categories can be derived from any document property:

```ts
// By file extension
categories: doc => /\.(?:ts|js)$/.test(doc.id) ? 'code' : 'docs'

// By explicit metadata
categories: doc => doc.metadata?.category
```

### Cloud Embeddings

```bash
pnpm add @ai-sdk/openai ai sqlite-vec
```

```ts
import { openai } from 'retriv/embeddings/openai'

const search = await createRetriv({
  driver: sqlite({
    path: './search.db',
    embeddings: openai(), // uses OPENAI_API_KEY env
  }),
})
```

### Cloud Vector DB

For serverless or edge deployments, compose separate vector and keyword drivers:

```ts
import { createRetriv } from 'retriv'
import libsql from 'retriv/db/libsql'
import sqliteFts from 'retriv/db/sqlite-fts'
import { openai } from 'retriv/embeddings/openai'

const search = await createRetriv({
  driver: {
    vector: libsql({
      url: 'libsql://your-db.turso.io',
      authToken: process.env.TURSO_AUTH_TOKEN,
      embeddings: openai(),
    }),
    keyword: sqliteFts({ path: './search.db' }),
  },
})
```

## How It Works

### Chunking

Chunking is opt-in. Pass a chunker from `retriv/chunkers/*` to split documents before indexing:

```ts
import { autoChunker } from 'retriv/chunkers/auto'
import { markdownChunker } from 'retriv/chunkers/markdown'
import { codeChunker } from 'retriv/chunkers/typescript'

// Markdown-aware splitting with configurable sizes
chunking: markdownChunker({ chunkSize: 500, chunkOverlap: 100 })

// Auto-detect by file extension (TS/JS → code, else → markdown)
chunking: autoChunker()

// AST-aware code splitting (TypeScript/JavaScript only)
chunking: codeChunker({
  maxChunkSize: 2000,
  filterImports: false,
  overlapLines: 0,
})

// Or pass any function matching the Chunker type
chunking: (content, meta) => [{ text: content }]
```

The auto chunker picks strategy by file extension:

| File type | Strategy | What it does |
|-----------|----------|--------------|
| `.ts` `.tsx` `.js` `.jsx` `.mjs` `.mts` `.cjs` `.cts` | TypeScript compiler API | Splits on function/class boundaries, extracts entities, scope, imports |
| `.md` `.mdx` | Heading-aware | Splits on headings with configurable overlap |
| Everything else | Heading-aware | Falls back to markdown-style splitting |

### Query Tokenization

Search queries are automatically expanded for code identifier matching:

| Query | Expanded | Why |
|-------|----------|-----|
| `getUserName` | `get User Name getUserName` | camelCase splitting |
| `MAX_RETRY_COUNT` | `MAX RETRY COUNT MAX_RETRY_COUNT` | snake_case splitting |
| `React.useState` | `React use State useState` | dotted path + camelCase |
| `how to get user` | `how to get user` | Natural language unchanged |

This improves [BM25](https://en.wikipedia.org/wiki/Okapi_BM25) recall on code identifiers while being transparent for natural language queries.

Available standalone:

```ts
import { tokenizeCodeQuery } from 'retriv/utils/code-tokenize'
```

### Filtering

Narrow search results by metadata using a MongoDB-style filter DSL. Filters are applied at the SQL level (not post-search), so you get exact result counts without over-fetching.

```ts
// Attach metadata when indexing
await search.index([
  { id: 'src/auth.ts', content: authCode, metadata: { type: 'code', lang: 'typescript' } },
  { id: 'src/api.ts', content: apiCode, metadata: { type: 'code', lang: 'typescript' } },
  { id: 'docs/guide.md', content: guide, metadata: { type: 'docs', category: 'guide' } },
  { id: 'docs/api-ref.md', content: apiRef, metadata: { type: 'docs', category: 'reference' } },
])

// Search only code files
await search.search('authentication', {
  filter: { type: 'code' },
})

// Search only docs under a path prefix
await search.search('authentication', {
  filter: { type: 'docs', category: { $prefix: 'guide' } },
})

// Combine multiple conditions (AND)
await search.search('handler', {
  filter: { type: 'code', lang: { $in: ['typescript', 'javascript'] } },
})
```

When chunking is enabled, chunks inherit their parent document's metadata — so filtering works on chunks too.

#### Operators

| Operator | Example | Description |
|----------|---------|-------------|
| exact match | `{ type: 'code' }` | Equals value |
| `$eq` | `{ type: { $eq: 'code' } }` | Equals (explicit) |
| `$ne` | `{ type: { $ne: 'draft' } }` | Not equals |
| `$gt` `$gte` `$lt` `$lte` | `{ priority: { $gt: 5 } }` | Numeric comparisons |
| `$in` | `{ lang: { $in: ['ts', 'js'] } }` | Value in list |
| `$prefix` | `{ source: { $prefix: 'src/api/' } }` | String starts with |
| `$exists` | `{ deprecated: { $exists: false } }` | Field presence check |

Multiple keys in a filter are ANDed together.

#### Per-driver implementation

| Driver | Strategy |
|--------|----------|
| SQLite hybrid | Native SQL — [FTS5](https://www.sqlite.org/fts5.html) `JOIN` + vec0 `rowid IN` subquery |
| SQLite [FTS5](https://www.sqlite.org/fts5.html) | Native SQL — `JOIN` with metadata table |
| sqlite-vec | Native SQL — `rowid IN` subquery |
| pgvector | Native SQL — JSONB `WHERE` clauses |
| LibSQL | Native SQL — `json_extract` `WHERE` clauses |
| Upstash | Post-search filtering (4x over-fetch) |
| Cloudflare | Post-search filtering (4x over-fetch) |

## Drivers

### Hybrid ([BM25](https://en.wikipedia.org/wiki/Okapi_BM25) + Vector)

| Driver | Import | Peer Dependencies |
|--------|--------|-------------------|
| SQLite | `retriv/db/sqlite` | `sqlite-vec` (Node.js >= 22.5) |

### Vector-Only

| Driver | Import | Peer Dependencies |
|--------|--------|-------------------|
| LibSQL | `retriv/db/libsql` | `@libsql/client` |
| Upstash | `retriv/db/upstash` | `@upstash/vector` |
| Cloudflare | `retriv/db/cloudflare` | — (uses Cloudflare bindings) |
| pgvector | `retriv/db/pgvector` | `pg` |
| sqlite-vec | `retriv/db/sqlite-vec` | `sqlite-vec` (Node.js >= 22.5) |

### Keyword-Only ([BM25](https://en.wikipedia.org/wiki/Okapi_BM25))

| Driver | Import | Peer Dependencies |
|--------|--------|-------------------|
| SQLite [FTS5](https://www.sqlite.org/fts5.html) | `retriv/db/sqlite-fts` | — (Node.js >= 22.5) |

## Embedding Providers

All vector drivers accept an `embeddings` config:

| Provider | Import | Peer Dependencies |
|----------|--------|-------------------|
| OpenAI | `retriv/embeddings/openai` | `@ai-sdk/openai ai` |
| Google | `retriv/embeddings/google` | `@ai-sdk/google ai` |
| Mistral | `retriv/embeddings/mistral` | `@ai-sdk/mistral ai` |
| Cohere | `retriv/embeddings/cohere` | `@ai-sdk/cohere ai` |
| Ollama | `retriv/embeddings/ollama` | `ollama-ai-provider-v2 ai` |
| Transformers.js | `retriv/embeddings/transformers-js` | `@huggingface/transformers` |

```ts
// Cloud (require API keys)
openai({ model: 'text-embedding-3-small' })
google({ model: 'text-embedding-004' })
mistral({ model: 'mistral-embed' })
cohere({ model: 'embed-english-v3.0' })

// Local (no API key)
ollama({ model: 'nomic-embed-text' })
transformersJs({ model: 'Xenova/all-MiniLM-L6-v2' })
```

## API

### SearchProvider

All drivers implement the same interface:

```ts
interface SearchProvider {
  index: (docs: Document[]) => Promise<{ count: number }>
  search: (query: string, options?: SearchOptions) => Promise<SearchResult[]>
  remove?: (ids: string[]) => Promise<{ count: number }>
  clear?: () => Promise<void>
  close?: () => Promise<void>
}
```

### SearchOptions

```ts
interface SearchOptions {
  limit?: number // Max results (default varies by driver)
  returnContent?: boolean // Include original content in results
  returnMetadata?: boolean // Include metadata in results
  returnMeta?: boolean // Include driver-specific _meta
  filter?: SearchFilter // Filter by metadata fields
}
```

### SearchResult

```ts
interface SearchResult {
  id: string // Document ID (or chunk ID like "src/auth.ts#chunk-0")
  score: number // 0-1, higher is better
  content?: string // If returnContent: true
  metadata?: Record<string, any> // If returnMetadata: true
  _chunk?: ChunkInfo // When chunking enabled (see below)
  _meta?: SearchMeta // If returnMeta: true (driver-specific extras)
}
```

### ChunkInfo

When chunking is enabled, each result includes `_chunk` with source mapping and AST metadata:

```ts
interface ChunkInfo {
  parentId: string // Original document ID
  index: number // Chunk position (0-based)
  range?: [number, number] // Character range in original content
  lineRange?: [number, number] // Line range in original content
  entities?: ChunkEntity[] // Functions, classes, methods defined in this chunk
  scope?: ChunkEntity[] // Containing scope chain (e.g. class this method is inside)
}

interface ChunkEntity {
  name: string // e.g. "hashPassword"
  type: string // e.g. "function", "class", "method"
  signature?: string // e.g. "async hashPassword(raw: string): Promise<string>"
  isPartial?: boolean // true if entity was split across chunks
}
```

Code chunks also produce `imports` and `siblings` on the `ChunkerChunk` level (available when writing custom chunkers):

```ts
interface ChunkerChunk {
  text: string
  lineRange?: [number, number]
  context?: string // Contextualized prefix for embeddings
  entities?: ChunkEntity[]
  scope?: ChunkEntity[]
  imports?: ChunkImport[] // { name, source, isDefault?, isNamespace? }
  siblings?: ChunkSibling[] // { name, type, position: 'before'|'after', distance }
}
```

## Related

- [skilld](https://github.com/harlan-zw/skilld) — Generate agent skills from npm package docs, uses retriv for search

## Sponsors

<p align="center">
  <a href="https://raw.githubusercontent.com/harlan-zw/static/main/sponsors.svg">
    <img src='https://raw.githubusercontent.com/harlan-zw/static/main/sponsors.svg'/>
  </a>
</p>

## License

Licensed under the [MIT license](https://github.com/harlan-zw/retriv/blob/main/LICENSE).
