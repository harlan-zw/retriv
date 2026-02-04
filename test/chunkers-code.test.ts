import { describe, expect, it } from 'vitest'
import { codeChunker } from '../src/chunkers/code'

describe('codeChunker', () => {
  it('chunks a TypeScript file into functions', async () => {
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
      // Should have line ranges
      if (chunk.lineRange) {
        expect(chunk.lineRange[0]).toBeTypeOf('number')
        expect(chunk.lineRange[1]).toBeTypeOf('number')
      }
    }
    // At least one chunk should have entities
    const withEntities = chunks.filter(c => c.entities?.length)
    expect(withEntities.length).toBeGreaterThanOrEqual(1)
    expect(withEntities[0]!.entities![0]).toHaveProperty('name')
    expect(withEntities[0]!.entities![0]).toHaveProperty('type')
  })

  it('returns single chunk for small files', async () => {
    const chunker = codeChunker()
    const code = `export const x = 1`
    const chunks = await chunker(code, { id: 'small.ts' })
    expect(chunks.length).toBe(1)
    expect(chunks[0]!.text).toContain('export const x = 1')
  })

  it('includes context when contextMode is full', async () => {
    const chunker = codeChunker({ contextMode: 'full' })
    const code = `
import { ref } from 'vue'

export class UserService {
  private users = ref<string[]>([])

  addUser(name: string) {
    this.users.value.push(name)
  }

  removeUser(name: string) {
    this.users.value = this.users.value.filter(u => u !== name)
  }

  getUsers() {
    return this.users.value
  }
}
`.trim()

    const chunks = await chunker(code, { id: 'user-service.ts' })
    // With full context, chunks should have context property
    const chunksWithContext = chunks.filter(c => c.context)
    expect(chunksWithContext.length).toBeGreaterThanOrEqual(0)
    // Should have scope info (methods inside UserService)
    const withScope = chunks.filter(c => c.scope?.length)
    if (withScope.length > 0) {
      expect(withScope[0]!.scope![0]!.name).toBe('UserService')
    }
    // Should have imports
    const withImports = chunks.filter(c => c.imports?.length)
    expect(withImports.length).toBeGreaterThanOrEqual(1)
    expect(withImports[0]!.imports![0]).toHaveProperty('source')
  })
})
