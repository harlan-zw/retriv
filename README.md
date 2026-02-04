<h1>retriv</h1>

[![npm version](https://img.shields.io/npm/v/retriv?color=yellow)](https://npmjs.com/package/retriv)
[![npm downloads](https://img.shields.io/npm/dm/retriv?color=yellow)](https://npm.chart.dev/retriv)
[![license](https://img.shields.io/github/license/harlan-zw/retriv?color=yellow)](https://github.com/harlan-zw/retriv/blob/main/LICENSE)

> Hybrid search for code and documents. [BM25](https://en.wikipedia.org/wiki/Okapi_BM25) keyword + vector semantic search with [Reciprocal Rank Fusion](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf) for [up to 30% better recall](https://ragaboutit.com/hybrid-retrieval-for-enterprise-rag-when-to-use-bm25-vectors-or-both/) than single methods. Local first with cloud integrations.

## Why?

Most search tools force you to choose: keyword search (fast, exact matches) or vector search (semantic understanding). Neither alone is good enough for mixed codebases with both code and documentation.

- **Keyword-only** misses semantic matches — searching "authentication" won't find `verifyCredentials()`
- **Vector-only** misses exact identifiers — searching `getUserName` returns fuzzy matches instead of the function
- **Code needs special handling** — `camelCase` and `snake_case` identifiers need tokenization, AST-aware chunking preserves function boundaries

**Alternative approaches have trade-offs:**

| Approach | Problem |
|----------|---------|
| Elasticsearch/Typesense | Heavy infrastructure for a search index |
| Raw embeddings + [cosine similarity](https://en.wikipedia.org/wiki/Cosine_similarity) | No keyword fallback, misses exact matches |
| Custom [BM25](https://en.wikipedia.org/wiki/Okapi_BM25) + vector pipeline | Lots of glue code, score normalization headaches |

**retriv solves this:** single `createRetriv()` call gives you hybrid search with [RRF fusion](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf), dual AND+OR keyword queries with weighted rank fusion for both precision and recall, AST-aware code chunking, and automatic query expansion. Swap backends without changing your search code.

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

- 🎯 **3-way hybrid fusion search** — AND keywords + OR keywords + vector semantic, merged via weighted [RRF](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf)
- 🌳 **AST-aware code chunking** — [tree-sitter](https://tree-sitter.github.io/) splits on function/class boundaries (TypeScript, JavaScript)
- 🔤 **Automatic query expansion** — `camelCase`/`snake_case` identifiers tokenized for [BM25](https://en.wikipedia.org/wiki/Okapi_BM25)
- 🔍 **Metadata filtering** — narrow results by file type, path prefix, or any custom field
- 🔌 **Swappable backends** — SQLite, LibSQL/Turso, pgvector, Upstash, Cloudflare Vectorize

## Installation

```bash
pnpm add retriv
```

For code search (AST-aware chunking):

```bash
pnpm add retriv code-chunk
```

## Quick Start

```ts
import { createRetriv } from 'retriv'
import sqlite from 'retriv/db/sqlite'
import { transformers } from 'retriv/embeddings/transformers'

const search = await createRetriv({
  driver: sqlite({
    path: './search.db',
    embeddings: transformers(), // runs locally, no API key
  }),
})

await search.index([
  { id: 'src/auth.ts', content: authFileContents },
  { id: 'docs/guide.md', content: guideContents },
])
```

Natural language queries match semantically across both code and docs:

```ts
const results = await search.search('password hashing')
// [
//   { id: 'src/auth.ts#chunk-2', score: 0.82, _chunk: { parentId: 'src/auth.ts', index: 2 } },
//   { id: 'docs/guide.md#chunk-0', score: 0.71, _chunk: { parentId: 'docs/guide.md', index: 0 } },
// ]
```

Code identifiers are auto-expanded for [BM25](https://en.wikipedia.org/wiki/Okapi_BM25) (`getUserName` → `"get User Name getUserName"`):

```ts
await search.search('getUserName')
// [
//   { id: 'src/auth.ts#chunk-1', score: 0.91, _chunk: { parentId: 'src/auth.ts', index: 1 } },
// ]
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

Chunking is enabled by default. Documents are split before indexing. Pass `chunking: false` to disable. The auto chunker picks strategy by file extension:

| File type | Strategy | What it does |
|-----------|----------|--------------|
| `.ts` `.tsx` `.js` `.jsx` `.mjs` `.mts` `.cjs` `.cts` | tree-sitter AST | Splits on function/class boundaries, preserves scope context |
| `.md` `.mdx` | Heading-aware | Splits on headings with configurable overlap |
| Everything else | Heading-aware | Falls back to markdown-style splitting |

If `code-chunk` is not installed, code files fall back to markdown-style splitting.

Override with a specific chunker:

```ts
import { codeChunker } from 'retriv/chunkers/code'
import { markdownChunker } from 'retriv/chunkers/markdown'

// Code only
chunking: { chunker: await codeChunker({ maxChunkSize: 2000 }) }

// Markdown only with custom sizes
chunking: { chunker: markdownChunker({ chunkSize: 500, chunkOverlap: 100 }) }

// Or pass any function matching the Chunker type
chunking: { chunker: (content, meta) => [{ text: content }] }
```

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
| SQLite [FTS5](https://www.sqlite.org/fts5.html) | `retriv/db/sqlite-fts` | `better-sqlite3` |

## Embedding Providers

All vector drivers accept an `embeddings` config:

| Provider | Import | Peer Dependencies |
|----------|--------|-------------------|
| OpenAI | `retriv/embeddings/openai` | `@ai-sdk/openai ai` |
| Google | `retriv/embeddings/google` | `@ai-sdk/google ai` |
| Mistral | `retriv/embeddings/mistral` | `@ai-sdk/mistral ai` |
| Cohere | `retriv/embeddings/cohere` | `@ai-sdk/cohere ai` |
| Ollama | `retriv/embeddings/ollama` | `ollama-ai-provider-v2 ai` |
| Transformers | `retriv/embeddings/transformers` | `@huggingface/transformers-js` |

```ts
// Cloud (require API keys)
openai({ model: 'text-embedding-3-small' })
google({ model: 'text-embedding-004' })
mistral({ model: 'mistral-embed' })
cohere({ model: 'embed-english-v3.0' })

// Local (no API key)
ollama({ model: 'nomic-embed-text' })
transformers({ model: 'Xenova/all-MiniLM-L6-v2' })
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
  _chunk?: ChunkInfo // When chunking enabled: { parentId, index, range }
  _meta?: SearchMeta // If returnMeta: true (driver-specific extras)
}
```

## Related

- [skilld](https://github.com/harlan-zw/skilld) — Generate agent skills from npm package docs, uses retriv for search
- [code-chunk](https://github.com/nicolo-ribaudo/tree-sitter-js) — AST-aware code chunking via tree-sitter

## Sponsors

<p align="center">
  <a href="https://raw.githubusercontent.com/harlan-zw/static/main/sponsors.svg">
    <img src='https://raw.githubusercontent.com/harlan-zw/static/main/sponsors.svg'/>
  </a>
</p>

## License

Licensed under the [MIT license](https://github.com/harlan-zw/retriv/blob/main/LICENSE).
