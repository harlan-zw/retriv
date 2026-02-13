import { defineBuildConfig } from 'obuild/config'

export default defineBuildConfig({
  entries: [
    {
      type: 'bundle',
      input: [
        // Core
        './src/index.ts',
        './src/retriv.ts',
        './src/types.ts',
        './src/utils/split-text.ts',
        // DB drivers
        './src/db/sqlite.ts',
        './src/db/sqlite-vec.ts',
        './src/db/sqlite-fts.ts',
        './src/db/libsql.ts',
        './src/db/upstash.ts',
        './src/db/cloudflare.ts',
        './src/db/pgvector.ts',
        // Embeddings
        './src/embeddings/openai.ts',
        './src/embeddings/google.ts',
        './src/embeddings/ollama.ts',
        './src/embeddings/transformers-js.ts',
        './src/embeddings/mistral.ts',
        './src/embeddings/cohere.ts',
        './src/embeddings/cached.ts',
        './src/embeddings/resolve.ts',
        './src/embeddings/model-info.ts',
        // Chunkers
        './src/chunkers/typescript.ts',
        './src/chunkers/markdown.ts',
        './src/chunkers/auto.ts',
        // Rerankers
        './src/rerankers/cohere.ts',
        './src/rerankers/jina.ts',
        './src/rerankers/transformers-js.ts',
        // Utils
        './src/utils/code-tokenize.ts',
      ],
    },
  ],
})
