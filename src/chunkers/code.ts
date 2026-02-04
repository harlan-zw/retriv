import type { Chunker, ChunkerChunk } from '../types'
import { chunk } from 'code-chunk'

export interface CodeChunkerOptions {
  /** Max chunk size in bytes. Default: 1000 (or derived from maxTokens) */
  maxChunkSize?: number
  /** Model max token window — used to derive maxChunkSize when not set (~3.5 chars/token, 85% headroom) */
  maxTokens?: number
  /** Context mode: 'none' | 'minimal' | 'full'. Default: 'full' */
  contextMode?: 'none' | 'minimal' | 'full'
  /** Level of sibling detail: 'none' | 'names' | 'signatures'. Default: 'signatures' */
  siblingDetail?: 'none' | 'names' | 'signatures'
  /** Filter out import statements from chunks. Default: false */
  filterImports?: boolean
  /** Lines of overlap between chunks. Default: 0 */
  overlapLines?: number
}

/**
 * Create a code-aware chunker using tree-sitter AST parsing.
 * Requires `code-chunk` package: `pnpm add code-chunk`
 *
 * Supports: TypeScript, JavaScript, Python, Rust, Go, Java
 */
export function codeChunker(options: CodeChunkerOptions = {}): Chunker {
  const {
    maxTokens,
    maxChunkSize = maxTokens ? Math.floor(maxTokens * 3.5 * 0.85) : 1000,
    contextMode = 'full',
    siblingDetail = 'signatures',
    filterImports = false,
    overlapLines = 0,
  } = options

  return async (content: string, meta?: { id?: string, metadata?: Record<string, any> }): Promise<ChunkerChunk[]> => {
    const filepath = meta?.id || 'file.ts'

    const chunks = await chunk(filepath, content, {
      maxChunkSize,
      contextMode,
      siblingDetail,
      filterImports,
      overlapLines,
    })

    if (chunks.length === 0) {
      return [{ text: content }]
    }

    return chunks.map(c => ({
      text: c.text,
      lineRange: [c.lineRange.start, c.lineRange.end] as [number, number],
      context: c.contextualizedText !== c.text
        ? c.contextualizedText.slice(0, c.contextualizedText.indexOf(c.text)).trim() || undefined
        : undefined,
      entities: c.context.entities.length > 0
        ? c.context.entities.map(e => ({
            name: e.name,
            type: e.type,
            signature: e.signature,
            isPartial: e.isPartial || undefined,
          }))
        : undefined,
      scope: c.context.scope.length > 0
        ? c.context.scope.map(s => ({ name: s.name, type: s.type }))
        : undefined,
      imports: c.context.imports.length > 0
        ? c.context.imports.map(i => ({
            name: i.name,
            source: i.source,
            isDefault: i.isDefault || undefined,
            isNamespace: i.isNamespace || undefined,
          }))
        : undefined,
      siblings: c.context.siblings.length > 0
        ? c.context.siblings.map(s => ({
            name: s.name,
            type: s.type,
            position: s.position,
            distance: s.distance,
          }))
        : undefined,
    }))
  }
}

export default codeChunker
