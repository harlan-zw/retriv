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

```bash
pnpm add @huggingface/transformers sqlite-vec
```

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
  {
    id: '1',
    content: 'How to mass delete Gmail emails using filters',
    metadata: { source: 'https://support.google.com/mail', title: 'Gmail Help' },
  },
  {
    id: '2',
    content: 'Setting up email forwarding rules in Outlook',
    metadata: { source: 'https://support.microsoft.com', title: 'Outlook Help' },
  },
])

const results = await search.search('bulk remove messages', { returnMetadata: true })
// Finds #1 via semantic similarity even without keyword overlap
// results[0].metadata.source → 'https://support.google.com/mail'
```

### Swap to Cloud Embeddings

Same hybrid driver, better embeddings:

```bash
pnpm add @ai-sdk/openai ai sqlite-vec
```

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

```bash
pnpm add @libsql/client better-sqlite3 @ai-sdk/openai ai
```

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

```bash
pnpm add @huggingface/transformers sqlite-vec
```

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

| Driver | Import | Peer Dependencies |
|--------|--------|-------------------|
| SQLite | `retriv/db/sqlite` | `sqlite-vec` (Node.js >= 22.5) |

### Vector-Only (for composed hybrid)

| Driver | Import | Peer Dependencies |
|--------|--------|-------------------|
| LibSQL | `retriv/db/libsql` | `@libsql/client` |
| Upstash | `retriv/db/upstash` | `@upstash/vector` |
| Cloudflare | `retriv/db/cloudflare` | — (uses Cloudflare bindings) |
| pgvector | `retriv/db/pgvector` | `pg` |
| sqlite-vec | `retriv/db/sqlite-vec` | `sqlite-vec` (Node.js >= 22.5) |

### Keyword-Only (for composed hybrid)

| Driver | Import | Peer Dependencies |
|--------|--------|-------------------|
| SQLite FTS5 | `retriv/db/sqlite-fts` | `better-sqlite3` |

## Embedding Providers

All vector drivers accept an `embeddings` config:

| Provider | Import | Peer Dependencies |
|----------|--------|-------------------|
| OpenAI | `retriv/embeddings/openai` | `@ai-sdk/openai ai` |
| Google | `retriv/embeddings/google` | `@ai-sdk/google ai` |
| Mistral | `retriv/embeddings/mistral` | `@ai-sdk/mistral ai` |
| Cohere | `retriv/embeddings/cohere` | `@ai-sdk/cohere ai` |
| Ollama | `retriv/embeddings/ollama` | `ollama-ai-provider-v2 ai` |
| Transformers | `retriv/embeddings/transformers` | `@huggingface/transformers` |

```ts
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

Retrieval accuracy on Nuxt documentation (2,817 chunks):

| Test Type | FTS | Vector | Hybrid |
|-----------|-----|--------|--------|
| Exact terminology (ports, config names) | 7/7 | 5/7 | 7/7 |
| Doc retrieval (keyword overlap) | 0/7 | 5/7 | 5/7 |
| Semantic queries (synonyms, no overlap) | 1/6 | 5/6 | 5/6 |
| **Total** | **8/20 (40%)** | **15/20 (75%)** | **17/20 (85%)** |

- **FTS** excels at exact terms but fails semantic queries ("reuse logic" → composables)
- **Vector** understands meaning but misses precise terminology (".global" suffix)
- **Hybrid** combines both - best overall recall across query types

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
