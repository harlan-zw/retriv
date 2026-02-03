import type { Chunker, ChunkerChunk } from '../types'
import type { CodeChunkerOptions } from './code'
import type { MarkdownChunkerOptions } from './markdown'
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
 *
 * Falls back to markdown chunker if code-chunk is not installed.
 */
export async function autoChunker(options: AutoChunkerOptions = {}): Promise<Chunker> {
  const mdChunker = markdownChunker(options.markdown)

  let codeChunkerFn: Chunker | undefined
  try {
    const { codeChunker } = await import('./code')
    codeChunkerFn = await codeChunker(options.code)
  }
  catch {
    // code-chunk not installed, will fall back to markdown
  }

  return async (content: string, meta?): Promise<ChunkerChunk[]> => {
    const filePath = meta?.id || ''
    const type = detectContentType(filePath)

    if (type === 'code' && codeChunkerFn) {
      return codeChunkerFn(content, meta)
    }
    return mdChunker(content, meta)
  }
}

export default autoChunker
