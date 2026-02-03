<h1>retriv</h1>

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]

Hybrid search for code and documents. BM25 keyword + vector semantic search with [RRF fusion](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf) for [up to 30% better recall](https://ragaboutit.com/hybrid-retrieval-for-enterprise-rag-when-to-use-bm25-vectors-or-both/) than single methods.

- AST-aware code chunking via [tree-sitter](https://tree-sitter.github.io/) (TypeScript, JavaScript)
- Automatic `camelCase`/`snake_case` query expansion for BM25
- File-type routing — code and markdown indexed with the right strategy automatically
- Swappable backends (SQLite, LibSQL/Turso, pgvector, Upstash, Cloudflare Vectorize)

<p align="center">
<table>
<tbody>
<td align="center">
<sub>Made possible by my <a href="https://github.com/sponsors/harlan-zw">Sponsor Program 💖</a><br> Follow me <a href="https://twitter.com/harlan_zw">@harlan_zw</a> 🐦 • Join <a href="https://discord.gg/275MBUBvgP">Discord</a> for help</sub><br>
</td>
</tbody>
</table>
</p>

## Installation

```bash
pnpm add retriv
```

For code search (AST-aware chunking):

```bash
pnpm add retriv code-chunk
```

## Quick Start — Code Search

Index source files, search with natural language or code identifiers. Chunking auto-detects file type from the document ID.

```ts
import { createRetriv } from 'retriv'
import sqliteFts from 'retriv/db/sqlite-fts'

const search = await createRetriv({
  driver: sqliteFts({ path: './search.db' }),
  chunking: {},
})

await search.index([
  { id: 'src/auth.ts', content: authFileContents },
  { id: 'src/api.ts', content: apiFileContents },
  { id: 'docs/guide.md', content: guideContents },
])

// Natural language — works across code and docs
await search.search('password hashing')

// Code identifiers — auto-expanded for BM25
// getUserName → searches for "get User Name getUserName"
await search.search('getUserName')
```

That's it. `chunking: {}` enables the auto chunker which routes `.ts`/`.py`/`.rs`/etc. through tree-sitter AST splitting and `.md` through heading-aware markdown splitting. Query tokenization expands code identifiers automatically (no-op on natural language).

### With Vector Embeddings (Hybrid)

Add semantic search for synonym matching and meaning-based retrieval:

```bash
pnpm add retriv code-chunk @huggingface/transformers sqlite-vec
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
  chunking: {},
})
```

BM25 finds `hashPassword` when you search "hash password". Vectors find it when you search "encrypt credentials". Hybrid finds it either way.

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
  chunking: {},
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
  chunking: {},
})
```

## How It Works

### Chunking

When `chunking` is enabled, documents are split before indexing. The default auto chunker picks strategy by file extension:

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

This improves BM25 recall on code identifiers while being transparent for natural language queries.

Available standalone:

```ts
import { tokenizeCodeQuery } from 'retriv/utils/code-tokenize'
```

## Drivers

### Hybrid (BM25 + Vector)

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

### Keyword-Only (BM25)

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
