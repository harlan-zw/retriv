import type { EmbeddingCacheStorage } from '../src/embeddings/cached'
import type { Embedding, EmbeddingConfig } from '../src/types'
import { describe, expect, it } from 'vitest'
import { cachedEmbeddings } from '../src/embeddings/cached'

function memoryStorage(): EmbeddingCacheStorage & { store: Map<string, Embedding> } {
  const store = new Map<string, Embedding>()
  return {
    store,
    get: (hash: string) => store.get(hash) ?? null,
    set: (hash: string, embedding: Embedding) => { store.set(hash, embedding) },
  }
}

function fakeConfig(dims = 4, embedder?: (texts: string[]) => Promise<Float32Array[]>) {
  const calls: string[][] = []
  const defaultEmbedder = async (texts: string[]) => {
    calls.push(texts)
    return texts.map(() => new Float32Array(dims).fill(1))
  }
  return {
    config: {
      resolve: async () => ({
        embedder: embedder ?? defaultEmbedder,
        dimensions: dims,
      }),
    } satisfies EmbeddingConfig,
    calls,
  }
}

describe('cachedEmbeddings', () => {
  it('computes embeddings on cache miss', async () => {
    const storage = memoryStorage()
    const { config, calls } = fakeConfig()
    const wrapped = cachedEmbeddings(config, { storage })
    const { embedder } = await wrapped.resolve()

    const result = await embedder(['hello', 'world'])

    expect(result).toHaveLength(2)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(['hello', 'world'])
    expect(storage.store.size).toBe(2)
  })

  it('serves cached embeddings on hit', async () => {
    const storage = memoryStorage()
    const { config, calls } = fakeConfig()
    const wrapped = cachedEmbeddings(config, { storage })
    const { embedder } = await wrapped.resolve()

    await embedder(['hello', 'world'])
    const result = await embedder(['hello', 'world'])

    expect(result).toHaveLength(2)
    expect(calls).toHaveLength(1)
  })

  it('computes only missed texts on partial hit', async () => {
    const storage = memoryStorage()
    const { config, calls } = fakeConfig()
    const wrapped = cachedEmbeddings(config, { storage })
    const { embedder } = await wrapped.resolve()

    await embedder(['hello'])
    await embedder(['hello', 'world'])

    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual(['hello'])
    expect(calls[1]).toEqual(['world'])
  })

  it('returns correct embeddings for mixed hits/misses', async () => {
    const storage = memoryStorage()
    let counter = 0
    const { config } = fakeConfig(2, async (texts) => {
      return texts.map(() => {
        counter++
        return new Float32Array([counter, counter * 10])
      })
    })
    const wrapped = cachedEmbeddings(config, { storage })
    const { embedder } = await wrapped.resolve()

    await embedder(['a', 'b'])
    // a → [1, 10], b → [2, 20]

    const result = await embedder(['b', 'c', 'a'])
    // b → cached [2, 20], c → new [3, 30], a → cached [1, 10]

    expect(Array.from(result[0] as Float32Array)).toEqual([2, 20])
    expect(Array.from(result[1] as Float32Array)).toEqual([3, 30])
    expect(Array.from(result[2] as Float32Array)).toEqual([1, 10])
  })

  it('preserves dimensions and maxTokens from resolved config', async () => {
    const storage = memoryStorage()
    const config: EmbeddingConfig = {
      resolve: async () => ({
        embedder: async () => [],
        dimensions: 768,
        maxTokens: 512,
      }),
    }
    const wrapped = cachedEmbeddings(config, { storage })
    const resolved = await wrapped.resolve()

    expect(resolved.dimensions).toBe(768)
    expect(resolved.maxTokens).toBe(512)
  })

  it('handles empty input', async () => {
    const storage = memoryStorage()
    const { config, calls } = fakeConfig()
    const wrapped = cachedEmbeddings(config, { storage })
    const { embedder } = await wrapped.resolve()

    const result = await embedder([])
    expect(result).toHaveLength(0)
    expect(calls).toHaveLength(0)
  })

  it('shares cache across resolve() calls', async () => {
    const storage = memoryStorage()
    const { config, calls } = fakeConfig()

    const { embedder: e1 } = await cachedEmbeddings(config, { storage }).resolve()
    await e1(['hello'])

    const { embedder: e2 } = await cachedEmbeddings(config, { storage }).resolve()
    await e2(['hello'])

    expect(calls).toHaveLength(1)
  })
})
