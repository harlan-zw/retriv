import type { Chunker } from '../types'
import { splitText } from '../utils/split-text'

export interface MarkdownChunkerOptions {
  chunkSize?: number
  chunkOverlap?: number
}

/**
 * Markdown-aware chunker using heading-based recursive splitting.
 * This is the default chunker used by retriv when no custom chunker is provided.
 */
export function markdownChunker(options: MarkdownChunkerOptions = {}): Chunker {
  const { chunkSize = 1000, chunkOverlap = 200 } = options
  return (content: string) => {
    const chunks = splitText(content, { chunkSize, chunkOverlap })
    return chunks.map(c => ({
      text: c.text,
      range: c.range,
    }))
  }
}

export default markdownChunker
