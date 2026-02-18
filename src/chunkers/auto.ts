import type { Chunker, ChunkerChunk } from '../types'
import type { MarkdownChunkerOptions } from './markdown'
import type { CodeChunkerOptions } from './typescript'
import { markdownChunker } from './markdown'

const CODE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'mts',
  'cts',
  'js',
  'jsx',
  'mjs',
  'cjs',
])

/**
 * Detect whether a file path points to code or markdown content
 */
export function detectContentType(filePath: string): 'code' | 'markdown' {
  const ext = filePath.split('.').pop()?.toLowerCase()
  if (ext && CODE_EXTENSIONS.has(ext))
    return 'code'
  return 'markdown'
}

export interface AutoChunkerOptions {
  markdown?: MarkdownChunkerOptions
  code?: CodeChunkerOptions
}

/**
 * Auto-detecting chunker that routes to code or markdown chunker
 * based on file extension (derived from document ID).
 */
export function autoChunker(options: AutoChunkerOptions = {}): Chunker {
  const mdChunker = markdownChunker(options.markdown)
  let codeChunkerFn: Chunker | undefined

  return async (content: string, meta?): Promise<ChunkerChunk[]> => {
    const filePath = meta?.id || ''
    const type = detectContentType(filePath)

    if (type === 'code') {
      if (!codeChunkerFn) {
        codeChunkerFn = await import('./typescript')
          .then(m => m.codeChunker(options.code))
          .catch(() => undefined)
      }
      if (codeChunkerFn)
        return codeChunkerFn(content, meta)
    }
    return mdChunker(content, meta)
  }
}

export default autoChunker
