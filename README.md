<h1>retriv</h1>

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]

Index and retrieve Markdown documents with [up to 30% better recall](https://ragaboutit.com/hybrid-retrieval-for-enterprise-rag-when-to-use-bm25-vectors-or-both/) using hybrid search.

Keyword search (BM25) finds exact matches but misses synonyms. Semantic search understands meaning but struggles with names, codes, and precise terminology. Hybrid search combines both using [Reciprocal Rank Fusion](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf) - [research shows up to 5.8x improvement](https://www.researchgate.net/publication/399428523_Hybrid_Dense-Sparse_Retrieval_for_High-Recall_Information_Retrieval) on standard benchmarks.

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

- 🔀 **[Hybrid search](#local-first-sqlite)** - BM25 + vectors with [RRF fusion](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf) in a single SQLite file
- 🔌 **[Swappable backends](#drivers)** - SQLite, LibSQL/Turso, pgvector, Upstash, Cloudflare Vectorize
- 🧠 **[Any embedding provider](#embedding-providers)** - OpenAI, Google, Mistral, Cohere, Ollama, or local [Transformers.js](https://huggingface.co/docs/transformers.js)
- ✂️ **[Automatic chunking](#with-chunking)** - Split large documents with configurable overlap
- 📦 **[Unified interface](#api)** - Same `SearchProvider` API across all drivers

## Installation

```bash
pnpm add retriv
```

## Usage

### Local-First (SQLite)

Single file with BM25 + vector search. No external services needed.

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
  { id: '1', content: 'How to mass delete Gmail emails using filters' },
  { id: '2', content: 'Setting up email forwarding rules in Outlook' },
])

const results = await search.search('bulk remove messages')
// Finds #1 via semantic similarity even without keyword overlap
```

### Swap to Cloud Embeddings

Same hybrid driver, better embeddings:

```ts
import { createRetriv } from 'retriv'
import sqlite from 'retriv/db/sqlite'
import { openai } from 'retriv/embeddings/openai'

const search = await createRetriv({
  driver: sqlite({
    path: './search.db',
    embeddings: openai(), // uses OPENAI_API_KEY env
  }),
})
```

### Swap to Cloud Vector DB

For serverless or edge deployments:

```ts
import { createRetriv } from 'retriv'
import libsql from 'retriv/db/libsql'
import sqliteFts from 'retriv/db/sqlite-fts'
import { openai } from 'retriv/embeddings/openai'

const search = await createRetriv({
  driver: {
    // Turso for vectors
    vector: libsql({
      url: 'libsql://your-db.turso.io',
      authToken: process.env.TURSO_AUTH_TOKEN,
      embeddings: openai(),
    }),
    // Local SQLite for BM25
    keyword: sqliteFts({ path: './search.db' }),
  },
})
```

### With Chunking

Automatically split large documents:

```ts
import { createRetriv } from 'retriv'
import sqlite from 'retriv/db/sqlite'
import { transformers } from 'retriv/embeddings/transformers'

const search = await createRetriv({
  driver: sqlite({
    path: './search.db',
    embeddings: transformers(),
  }),
  chunking: {
    chunkSize: 1000,
    chunkOverlap: 200,
  },
})

await search.index([
  { id: 'doc-1', content: veryLongArticle },
])

const results = await search.search('specific topic')
// Results include _chunk: { parentId, index, range }
```

## Drivers

### Hybrid (Recommended)

| Driver | Import | Use Case |
|--------|--------|----------|
| SQLite | `retriv/db/sqlite` | BM25 + vector in single file, Node.js >= 22.5 |

### Vector-Only (for composed hybrid)

| Driver | Import | Use Case |
|--------|--------|----------|
| LibSQL | `retriv/db/libsql` | Turso, edge |
| Upstash | `retriv/db/upstash` | Serverless (text-native, no client embeddings) |
| Cloudflare | `retriv/db/cloudflare` | Cloudflare Workers |
| pgvector | `retriv/db/pgvector` | PostgreSQL |
| sqlite-vec | `retriv/db/sqlite-vec` | Local vector-only |

### Keyword-Only (for composed hybrid)

| Driver | Import | Use Case |
|--------|--------|----------|
| SQLite FTS5 | `retriv/db/sqlite-fts` | BM25 ranking |

## Embedding Providers

All vector drivers accept an `embeddings` config:

```ts
import { cohere } from 'retriv/embeddings/cohere'
import { google } from 'retriv/embeddings/google'
import { mistral } from 'retriv/embeddings/mistral'
import { ollama } from 'retriv/embeddings/ollama'
import { openai } from 'retriv/embeddings/openai'
import { transformers } from 'retriv/embeddings/transformers'

// Cloud providers (require API keys)
openai({ model: 'text-embedding-3-small' })
google({ model: 'text-embedding-004' })
mistral({ model: 'mistral-embed' })
cohere({ model: 'embed-english-v3.0' })

// Local (no API key)
ollama({ model: 'nomic-embed-text' })
transformers({ model: 'Xenova/all-MiniLM-L6-v2' })
```

## API

### SearchProvider Interface

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

### Search Options

```ts
interface SearchOptions {
  limit?: number // Max results (default varies by driver)
  returnContent?: boolean // Include original content in results
  returnMetadata?: boolean // Include metadata in results
  returnMeta?: boolean // Include driver-specific _meta
}
```

### Search Result

```ts
interface SearchResult {
  id: string // Document ID
  score: number // 0-1, higher is better
  content?: string // If returnContent: true
  metadata?: Record<string, any> // If returnMetadata: true
  _chunk?: ChunkInfo // When chunking enabled
  _meta?: SearchMeta // If returnMeta: true (driver-specific extras)
}
```

## Benchmarks

Retrieval accuracy on Nuxt documentation (639 docs):

| Test Type | FTS | Vector | Hybrid |
|-----------|-----|--------|--------|
| Exact terminology (ports, config names) | 3/3 | 2/3 | 3/3 |
| Doc retrieval (keyword overlap) | 3/3 | 2/3 | 3/3 |
| Semantic queries (synonyms, no overlap) | 0/3 | 3/3 | 3/3 |
| **Total** | **6/9 (67%)** | **7/9 (78%)** | **9/9 (100%)** |

- **FTS** excels at exact terms but fails semantic queries ("reuse logic" → composables)
- **Vector** understands meaning but misses precise terminology ("port 3000")
- **Hybrid** combines both - never worse than either method alone

Run locally: `pnpm test:eval`

## Sponsors

<p align="center">
  <a href="https://raw.githubusercontent.com/harlan-zw/static/main/sponsors.svg">
    <img src='https://raw.githubusercontent.com/harlan-zw/static/main/sponsors.svg'/>
  </a>
</p>

## License

Licensed under the [MIT license](https://github.com/harlan-zw/retriv/blob/main/LICENSE).

<!-- Badges -->
[npm-version-src]: https://img.shields.io/npm/v/retriv/latest.svg?style=flat&colorA=18181B&colorB=28CF8D
[npm-version-href]: https://npmjs.com/package/retriv

[npm-downloads-src]: https://img.shields.io/npm/dm/retriv.svg?style=flat&colorA=18181B&colorB=28CF8D
[npm-downloads-href]: https://npmjs.com/package/retriv

[license-src]: https://img.shields.io/github/license/harlan-zw/retriv.svg?style=flat&colorA=18181B&colorB=28CF8D
[license-href]: https://github.com/harlan-zw/retriv/blob/main/LICENSE
