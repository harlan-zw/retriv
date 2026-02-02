import { transformers } from '../../../src/embeddings/transformers'

// Shared embeddings config - small, fast model
export const embeddings = transformers({
  model: 'Xenova/all-MiniLM-L6-v2',
})
