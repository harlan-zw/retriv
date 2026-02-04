import type { Chunker, ChunkerChunk } from '../types'
import { chunk } from 'code-chunk'

export interface CodeChunkerOptions {
  /** Max chunk size in characters. Default: 1500 */
  maxChunkSize?: number
  /** Context mode: 'none' | 'minimal' | 'full'. Default: 'full' */
  contextMode?: 'none' | 'minimal' | 'full'
  /** Lines of overlap between chunks. Default: 0 */
  overlapLines?: number
}

/**
 * Create a code-aware chunker using tree-sitter AST parsing.
 * Requires `code-chunk` package: `pnpm add code-chunk`
 *
 * Supports: TypeScript, JavaScript
 */
export function codeChunker(options: CodeChunkerOptions = {}): Chunker {
  const {
    maxChunkSize = 1500,
    contextMode = 'full',
    overlapLines = 0,
  } = options

  return async (content: string, meta?: { id?: string, metadata?: Record<string, any> }): Promise<ChunkerChunk[]> => {
    const filepath = meta?.id || 'file.ts'

    const chunks = await chunk(filepath, content, {
      maxChunkSize,
      contextMode,
      overlapLines,
    })

    if (chunks.length === 0) {
      return [{ text: content }]
    }

    return chunks.map(c => ({
      text: c.text,
      context: c.contextualizedText !== c.text
        ? c.contextualizedText.slice(0, c.contextualizedText.indexOf(c.text)).trim() || undefined
        : undefined,
    }))
  }
}

export default codeChunker
