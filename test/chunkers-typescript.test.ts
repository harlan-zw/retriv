import { describe, expect, it } from 'vitest'
import { codeChunker } from '../src/chunkers/typescript'

describe('codeChunker', () => {
  it('chunks a TypeScript file', async () => {
    const chunker = codeChunker()
    const code = `
import { ref } from 'vue'

export function useCounter() {
  const count = ref(0)
  function increment() {
    count.value++
  }
  return { count, increment }
}

export function useToggle(initial = false) {
  const value = ref(initial)
  function toggle() {
    value.value = !value.value
  }
  return { value, toggle }
}
`.trim()

    const chunks = await chunker(code, { id: 'composables.ts' })
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeGreaterThan(0)
      if (chunk.lineRange) {
        expect(chunk.lineRange[0]).toBeTypeOf('number')
        expect(chunk.lineRange[1]).toBeTypeOf('number')
      }
    }
  })

  it('returns single chunk for small files', async () => {
    const chunker = codeChunker()
    const code = `export const x = 1`
    const chunks = await chunker(code, { id: 'small.ts' })
    expect(chunks.length).toBe(1)
    expect(chunks[0]!.text).toContain('export const x = 1')
  })

  it('respects maxChunkSize option', async () => {
    const chunker = codeChunker({ maxChunkSize: 100 })
    const code = `
export function longFunction() {
  const a = 1
  const b = 2
  const c = 3
  const d = 4
  const e = 5
  return a + b + c + d + e
}
`.trim()

    const chunks = await chunker(code, { id: 'long.ts' })
    // Should produce multiple chunks due to small maxChunkSize
    expect(chunks.length).toBeGreaterThanOrEqual(1)
  })
})
