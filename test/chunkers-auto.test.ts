import { describe, expect, it } from 'vitest'
import { autoChunker, detectContentType } from '../src/chunkers/auto'
import { markdownChunker } from '../src/chunkers/markdown'

describe('detectContentType', () => {
  it('detects TypeScript files', () => {
    expect(detectContentType('src/utils/helper.ts')).toBe('code')
    expect(detectContentType('app.tsx')).toBe('code')
  })

  it('detects JavaScript files', () => {
    expect(detectContentType('index.js')).toBe('code')
    expect(detectContentType('App.jsx')).toBe('code')
  })

  it('treats non-JS/TS as markdown', () => {
    // Python, Rust, Go, Java now fall back to markdown (TS compiler API only supports JS/TS)
    expect(detectContentType('main.py')).toBe('markdown')
    expect(detectContentType('lib.rs')).toBe('markdown')
    expect(detectContentType('main.go')).toBe('markdown')
    expect(detectContentType('App.java')).toBe('markdown')
  })

  it('detects markdown files', () => {
    expect(detectContentType('README.md')).toBe('markdown')
    expect(detectContentType('docs/guide.mdx')).toBe('markdown')
  })

  it('defaults to markdown for unknown', () => {
    expect(detectContentType('config.yaml')).toBe('markdown')
    expect(detectContentType('data.json')).toBe('markdown')
  })

  it('handles paths without extensions', () => {
    expect(detectContentType('Dockerfile')).toBe('markdown')
  })
})

describe('autoChunker', () => {
  it('uses markdown chunker for .md files', async () => {
    const chunker = autoChunker()
    const chunks = await chunker('# Hello\n\nWorld', { id: 'readme.md' })
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    expect(chunks[0]!.text).toContain('Hello')
  })

  it('uses code chunker for TypeScript files', async () => {
    const chunker = autoChunker()
    const chunks = await chunker('export const x = 1', { id: 'test.ts' })
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    expect(chunks[0]!.text).toContain('export const x = 1')
  })
})

describe('markdownChunker', () => {
  it('passes lineRange through from splitText', () => {
    const chunker = markdownChunker({ chunkSize: 50, chunkOverlap: 0 })
    const content = Array.from({ length: 10 }, (_, i) => `## Section ${i + 1}\n\nContent for section ${i + 1}.`).join('\n\n')
    const chunks = chunker(content) as { text: string, range?: [number, number], lineRange?: [number, number] }[]

    expect(chunks.length).toBeGreaterThanOrEqual(2)
    for (const chunk of chunks) {
      expect(chunk.lineRange).toBeDefined()
      expect(chunk.lineRange![1]).toBeGreaterThanOrEqual(chunk.lineRange![0])
    }
    // Different chunks must have different line ranges
    const keys = chunks.map(c => `${c.lineRange![0]}-${c.lineRange![1]}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
