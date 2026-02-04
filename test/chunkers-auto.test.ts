import { describe, expect, it } from 'vitest'
import { autoChunker, detectContentType } from '../src/chunkers/auto'

describe('detectContentType', () => {
  it('detects TypeScript files', () => {
    expect(detectContentType('src/utils/helper.ts')).toBe('code')
    expect(detectContentType('app.tsx')).toBe('code')
  })

  it('detects JavaScript files', () => {
    expect(detectContentType('index.js')).toBe('code')
    expect(detectContentType('App.jsx')).toBe('code')
  })

  it('detects Python files', () => {
    expect(detectContentType('main.py')).toBe('code')
    expect(detectContentType('types.pyi')).toBe('code')
  })

  it('detects Rust files', () => {
    expect(detectContentType('lib.rs')).toBe('code')
  })

  it('detects Go files', () => {
    expect(detectContentType('main.go')).toBe('code')
  })

  it('detects Java files', () => {
    expect(detectContentType('App.java')).toBe('code')
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

  it('falls back to markdown chunker when code-chunk unavailable', async () => {
    const chunker = autoChunker()
    // Even for .ts files, if code-chunk isn't installed, should fall back
    const chunks = await chunker('export const x = 1', { id: 'test.ts' })
    expect(chunks.length).toBeGreaterThanOrEqual(1)
  })
})
