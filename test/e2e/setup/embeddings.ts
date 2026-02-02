import { transformersJs } from '../../../src/embeddings/transformers-js'

// Shared embeddings config
export const embeddings = transformersJs({
  model: 'Xenova/bge-base-en-v1.5',
  dimensions: 768,
})
