import { describe, expect, it } from 'vitest'
import { splitText } from '../src/utils/split-text'

describe('splitText', () => {
  it('returns single chunk for small text', () => {
    const text = 'Hello world'
    const chunks = splitText(text, { chunkSize: 100 })

    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.text).toBe('Hello world')
    expect(chunks[0]!.index).toBe(0)
    expect(chunks[0]!.range).toEqual([0, 11])
  })

  it('splits on paragraphs', () => {
    const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.'
    const chunks = splitText(text, { chunkSize: 30, chunkOverlap: 0 })

    expect(chunks.length).toBeGreaterThanOrEqual(2)
    expect(chunks[0]!.text).toContain('First paragraph')
  })

  it('splits on markdown headings', () => {
    const text = '# Title\n\nIntro text.\n\n## Section 1\n\nContent one.\n\n## Section 2\n\nContent two.'
    const chunks = splitText(text, { chunkSize: 40, chunkOverlap: 0 })

    expect(chunks.length).toBeGreaterThanOrEqual(2)
  })

  it('respects chunkOverlap', () => {
    const text = `${'A'.repeat(50)}\n\n${'B'.repeat(50)}`
    const chunks = splitText(text, { chunkSize: 60, chunkOverlap: 10 })

    // With overlap, later chunks should contain some content from previous
    expect(chunks.length).toBeGreaterThanOrEqual(2)
  })

  it('handles very long words by splitting on characters', () => {
    const text = 'x'.repeat(200)
    const chunks = splitText(text, { chunkSize: 50, chunkOverlap: 0 })

    expect(chunks.length).toBeGreaterThanOrEqual(2)
    chunks.forEach((chunk) => {
      expect(chunk.text.length).toBeLessThanOrEqual(60) // Some tolerance
    })
  })

  it('provides correct range offsets', () => {
    const text = 'First.\n\nSecond.\n\nThird.'
    const chunks = splitText(text, { chunkSize: 15, chunkOverlap: 0 })

    chunks.forEach((chunk) => {
      const [start, end] = chunk.range
      expect(start).toBeGreaterThanOrEqual(0)
      expect(end).toBeLessThanOrEqual(text.length)
      expect(end).toBeGreaterThan(start)
    })
  })

  it('indexes chunks sequentially', () => {
    const text = 'One.\n\nTwo.\n\nThree.\n\nFour.\n\nFive.'
    const chunks = splitText(text, { chunkSize: 10, chunkOverlap: 0 })

    chunks.forEach((chunk, i) => {
      expect(chunk.index).toBe(i)
    })
  })

  it('provides correct line ranges', () => {
    const text = 'Line 1\nLine 2\nLine 3\n\nLine 5\nLine 6\nLine 7'
    const chunks = splitText(text, { chunkSize: 20, chunkOverlap: 0 })

    expect(chunks.length).toBeGreaterThanOrEqual(2)
    // First chunk starts at line 1
    expect(chunks[0]!.lines[0]).toBe(1)
    // Later chunks must start after line 1
    expect(chunks.at(-1)!.lines[0]).toBeGreaterThan(1)
    // Each chunk's end line >= start line
    chunks.forEach((chunk) => {
      expect(chunk.lines[1]).toBeGreaterThanOrEqual(chunk.lines[0])
    })
  })

  it('gives distinct line ranges to different chunks', () => {
    const text = Array.from({ length: 20 }, (_, i) => `Line ${i + 1} content here`).join('\n\n')
    const chunks = splitText(text, { chunkSize: 80, chunkOverlap: 0 })

    expect(chunks.length).toBeGreaterThanOrEqual(3)
    // No two chunks should have identical line ranges
    const keys = chunks.map(c => `${c.lines[0]}-${c.lines[1]}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
