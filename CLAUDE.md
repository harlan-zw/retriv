# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm build           # Build with obuild
pnpm dev:prepare     # Stub build for development
pnpm test            # Run vitest (unit tests)
pnpm test -- -t "chunks"  # Run single test by name
pnpm test:e2e        # Run e2e tests (all local drivers)
PG_URL=postgres://... pnpm test:e2e  # Include pgvector
pnpm lint            # ESLint
pnpm typecheck       # TypeScript check
```

## Architecture

**Hybrid search infrastructure for Markdown** - combines BM25 keyword + vector semantic search with RRF fusion for 15-30% better recall than single methods.

### Core Abstraction

`SearchProvider` (src/types.ts) - unified interface all drivers implement:
- `mode`: 'semantic' | 'fulltext' | 'hybrid'
- `index(docs)`: Index documents
- `search(query, options)`: Returns `SearchResult[]` with normalized 0-1 scores

### Driver Categories

**Hybrid** (src/db/):
- `sqlite.ts` - FTS5 + sqlite-vec combined, uses node:sqlite (Node 22.5+), RRF fusion

**FTS** (src/db/):
- `sqlite-fts.ts` - SQLite FTS5 with BM25 ranking, uses better-sqlite3

**Vector** (src/db/):
- `sqlite-vec.ts` - sqlite-vec extension, requires Node 22.5+
- `libsql.ts` - Turso/LibSQL (local or remote)
- `upstash.ts` - Serverless vector (text-native, no client embeddings)
- `cloudflare.ts` - Cloudflare Vectorize
- `pgvector.ts` - PostgreSQL with pgvector

**Embeddings** (src/embeddings/):
- `openai.ts`, `google.ts`, `mistral.ts`, `cohere.ts` - Cloud providers via AI SDK
- `ollama.ts` - Local Ollama
- `transformers.ts` - Transformers.js (pure JS, no API)
- `resolve.ts` - Lazy loads and caches embedding providers, detects dimensions

### Key Files

- `src/retriv.ts` - `createRetriv()` factory: multi-driver fusion (RRF k=60), chunking
- `src/db/sqlite.ts` - Single-file hybrid driver with built-in RRF fusion
- `src/utils/split-text.ts` - Text chunking for large documents

### Patterns

Drivers export both default and named exports:
```ts
export async function sqliteFts(config): Promise<SearchProvider>
export default sqliteFts
```

Vector drivers take `embeddings: EmbeddingConfig` from `retriv/embeddings/*`.

All drivers normalize scores to 0-1 range (higher = better match).

### Hybrid Search

Two ways to get hybrid search:
1. `retriv/db/sqlite` - Single driver with built-in FTS5 + vector fusion
2. `createRetriv({ driver: { vector, keyword } })` - Compose separate drivers

Both use Reciprocal Rank Fusion (RRF) with k=60 to merge results.
