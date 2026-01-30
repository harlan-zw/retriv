# vctrize

Unified vector database abstraction with AI SDK embeddings support.

## Features

- **Multiple vector DB drivers** - sqlite-vec, libsql/Turso, Upstash, Cloudflare Vectorize, pgvector
- **Unified adapter API** - Text-based interface that handles embeddings internally
- **AI SDK integration** - Works with any AI SDK embedding model
- **Model utilities** - Dimension lookup, provider mappings, capability detection
- **TypeScript first** - Full type safety with Cloudflare Vectorize-compatible types

## Installation

```bash
pnpm add vctrize
```

## Quick Start

```ts
import { createAdapter } from 'vctrize'
import { createSqliteVecDriver } from 'vctrize/drivers/sqlite-vec'

// Create a driver
const driver = await createSqliteVecDriver({
  path: './vectors.db',
  dimensions: 768,
})

// Create an adapter with an embedding model
import { experimental_createProviderRegistry as createProviderRegistry } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY })
const embeddingModel = openai.embedding('text-embedding-3-small')

const adapter = await createAdapter(driver, { embeddingModel })

// Upsert text (embeddings generated automatically)
await adapter.upsert([
  { id: '1', text: 'Hello world', metadata: { source: 'greeting' } },
  { id: '2', text: 'How are you?', metadata: { source: 'question' } },
])

// Query with text
const results = await adapter.query('Hi there')
console.log(results.matches)
```

## Drivers

### sqlite-vec (Node.js >= 22.5)

```ts
import { createSqliteVecDriver } from 'vctrize/drivers/sqlite-vec'

const driver = await createSqliteVecDriver({
  path: './vectors.db', // or ':memory:'
  dimensions: 768,
})
```

### LibSQL / Turso

```ts
import { createLibsqlDriver } from 'vctrize/drivers/libsql'

// Local file
const driver = await createLibsqlDriver({
  url: 'file:vectors.db',
  dimensions: 768,
})

// Remote Turso
const driver = await createLibsqlDriver({
  url: 'libsql://your-db.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN,
  dimensions: 768,
})
```

### Upstash Vector

```ts
import { createUpstashDriver } from 'vctrize/drivers/upstash'

const driver = await createUpstashDriver({
  url: process.env.UPSTASH_VECTOR_URL,
  token: process.env.UPSTASH_VECTOR_TOKEN,
  dimensions: 768,
  namespace: 'my-namespace', // optional
})
```

Note: Upstash uses text-native embeddings, so no embedding model is needed with the adapter.

### Cloudflare Vectorize

```ts
import { createCloudflareDriver } from 'vctrize/drivers/cloudflare'

// In a Cloudflare Worker
const driver = await createCloudflareDriver({
  binding: env.VECTORIZE,
  dimensions: 768,
})
```

### pgvector (PostgreSQL)

```ts
import { createPgvectorDriver } from 'vctrize/drivers/pgvector'

const driver = await createPgvectorDriver({
  url: process.env.DATABASE_URL,
  dimensions: 768,
})
```

## Model Utilities

```ts
import {
  getModelDimensions,
  resolveModelForPreset,
  isReasoningModel,
  supportsTools,
  MODEL_DIMENSIONS,
  DEFAULT_MODELS,
} from 'vctrize/model'

// Get dimensions for a model
getModelDimensions('bge-base-en-v1.5') // 768
getModelDimensions('text-embedding-3-small') // 1536

// Resolve model name for a provider
resolveModelForPreset('bge-base-en-v1.5', 'transformers.js') // 'Xenova/bge-base-en-v1.5'
resolveModelForPreset('bge-base-en-v1.5', 'workers-ai') // '@cf/baai/bge-base-en-v1.5'

// Check model capabilities
isReasoningModel('o1-preview') // true
supportsTools('llama3.2') // true
```

## License

MIT
