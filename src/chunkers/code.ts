import type { Chunker, ChunkerChunk } from '../types'

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
export async function codeChunker(options: CodeChunkerOptions = {}): Promise<Chunker> {
  const {
    maxChunkSize = 1500,
    contextMode = 'full',
    overlapLines = 0,
  } = options

  let chunkFn: typeof import('code-chunk')['chunk']
  try {
    const mod = await import('code-chunk')
    chunkFn = mod.chunk
  }
  catch {
    throw new Error('code-chunk is required for code chunking. Install it: pnpm add code-chunk')
  }

  return async (content: string, meta?: { id?: string, metadata?: Record<string, any> }): Promise<ChunkerChunk[]> => {
    const filepath = meta?.id || 'file.ts'

    const chunks = await chunkFn(filepath, content, {
      maxChunkSize,
      contextMode,
      overlapLines,
    })

    if (chunks.length === 0) {
      return [{ text: content }]
    }

    return chunks.map(chunk => ({
      text: chunk.text,
      context: chunk.contextualizedText !== chunk.text
        ? chunk.contextualizedText.slice(0, chunk.contextualizedText.indexOf(chunk.text)).trim() || undefined
        : undefined,
    }))
  }
}

export default codeChunker
