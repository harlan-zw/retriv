# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm build           # Build with obuild (bundle entries in build.config.ts)
pnpm dev:prepare     # Stub build for development
pnpm test            # Run vitest (unit tests)
pnpm test -- -t "chunks"  # Run single test by name
pnpm test:e2e        # Run e2e tests (all local drivers)
PG_URL=postgres://... pnpm test:e2e  # Include pgvector
pnpm test:eval       # Run evaluation tests
pnpm lint            # ESLint (@antfu/eslint-config)
pnpm typecheck       # TypeScript check
```

Requires Node.js >= 22.5 (for `node:sqlite`).

## Architecture

**Hybrid search infrastructure** - combines BM25 keyword + vector semantic search with RRF fusion for 15-30% better recall than single methods.

### Core Abstraction

`SearchProvider` (src/types.ts) - unified interface all drivers implement:
- `index(docs)`: Index documents
- `search(query, options)`: Returns `SearchResult[]` with normalized 0-1 scores
- `options.filter`: MongoDB-like metadata filtering (`$eq`, `$gt`, `$in`, `$prefix`, `$exists`, etc.)

### Driver Categories

**Hybrid** (src/db/):
- `sqlite.ts` - FTS5 + sqlite-vec combined, uses node:sqlite (Node 22.5+), RRF fusion

**FTS** (src/db/):
- `sqlite-fts.ts` - SQLite FTS5 with BM25 ranking, uses node:sqlite (Node 22.5+)

**Vector** (src/db/):
- `sqlite-vec.ts` - sqlite-vec extension, requires Node 22.5+
- `libsql.ts` - Turso/LibSQL (local or remote)
- `upstash.ts` - Serverless vector (text-native, no client embeddings)
- `cloudflare.ts` - Cloudflare Vectorize
- `pgvector.ts` - PostgreSQL with pgvector

**Embeddings** (src/embeddings/):
- `openai.ts`, `google.ts`, `mistral.ts`, `cohere.ts` - Cloud providers via AI SDK
- `ollama.ts` - Local Ollama
- `transformers-js.ts` - Transformers.js (pure JS, no API)
- `resolve.ts` - Lazy loads and caches embedding providers, detects dimensions
- `model-info.ts` - Model dimension registry, preset resolution (e.g. maps model names to Xenova/ prefixes)

**Rerankers** (src/rerankers/):
- `cohere.ts` - Cohere rerank API (rerank-v3.5 default)
- `jina.ts` - Jina rerank API
- `transformers-js.ts` - Local reranking with Transformers.js

**Chunkers** (src/chunkers/):
- `markdown.ts` - Heading-aware recursive splitting (default chunker)
- `typescript.ts` - TypeScript compiler API, extracts entities/scope/imports (TS/JS only, zero native deps)
- `auto.ts` - Routes TS/JS to typescript chunker, everything else to markdown

### Key Files

- `src/retriv.ts` - `createRetriv()` factory: multi-driver fusion (RRF k=60), opt-in chunking, split-category search
- `src/db/sqlite.ts` - Single-file hybrid driver with built-in RRF fusion
- `src/filter.ts` - Filter compilation (SQL for sqlite/pg) and in-memory matching
- `src/utils/split-text.ts` - Text chunking for large documents
- `src/utils/code-tokenize.ts` - Splits camelCase/snake_case identifiers for code search queries
- `src/utils/extract-snippet.ts` - BM25-scored snippet extraction around query matches

### Patterns

Drivers export both default and named exports:
```ts
export async function sqliteFts(config): Promise<SearchProvider>
export default sqliteFts
```

Vector drivers take `embeddings: EmbeddingConfig` from `retriv/embeddings/*`.

Embedding providers use lazy-resolve with caching — `resolve()` is called once, result cached:
```ts
export function openai(options = {}): EmbeddingConfig {
  let cached: ResolvedEmbedding | null = null
  return { async resolve() {
    if (cached)
      return cached; cached = result; return cached
  } }
}
```

All drivers normalize scores to 0-1 range (higher = better match).

Filter compilation has two SQL modes: `'json'` (SQLite `json_extract`) and `'jsonb'` (PostgreSQL `->>`). In-memory `matchesFilter()` is used by drivers without native SQL filtering (Upstash, Cloudflare) — these over-fetch 4x then filter client-side.

### Hybrid Search

Two ways to get hybrid search:
1. `retriv/db/sqlite` - Single driver with built-in FTS5 + vector fusion
2. `createRetriv({ driver: { vector, keyword } })` - Compose separate drivers

Both use Reciprocal Rank Fusion (RRF) with k=60 to merge results.

### Chunking

Chunking is opt-in via `createRetriv({ chunking: markdownChunker() })`. When enabled:
- Documents are split into chunks indexed as `{docId}#chunk-{i}`
- Chunk metadata (`_parentId`, `_chunkIndex`, `_chunkRange`) is attached
- Results include `_chunk: { parentId, index, range }` for reassembly
- Code queries are auto-tokenized (e.g. `getUserName` → `get User Name getUserName`)

### Split-Category Search

Opt-in via `createRetriv({ categories: (doc) => string })`. When enabled:
- Documents are auto-tagged with `metadata.category` at index time
- Search fans out per-category with filtered queries, results fused with RRF
- Prevents one category (e.g. prose) from drowning out another (e.g. code)
- Works with composed drivers (double RRF: inner driver fusion + outer category fusion)

### Rerankers

Optional post-search reranking via `retriv/rerankers/*`. Rerankers over-fetch (`limit * 3`) then trim to requested limit. Not in `build.config.ts` — used at runtime only.

### Test Infrastructure

Vitest config with three projects (in `vitest.config.ts`):
- **unit** - `test/**/*.test.ts` (excludes e2e)
- **e2e** - `test/e2e/**/*.test.ts` (excludes eval)
- **eval** - `test/**/*.eval.test.ts`

E2E tests skip drivers when env vars are missing (e.g. `PG_URL` for pgvector). Embedding-heavy tests use `beforeAll` with 300s timeout for model loading.
