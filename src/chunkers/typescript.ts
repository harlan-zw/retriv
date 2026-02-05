import type { ChunkEntity, Chunker, ChunkerChunk, ChunkImport, ChunkSibling } from '../types'
import ts from 'typescript'

export interface CodeChunkerOptions {
  /** Max chunk size in bytes. Default: 1000 (or derived from maxTokens) */
  maxChunkSize?: number
  /** Model max token window — used to derive maxChunkSize when not set (~3.5 chars/token, 85% headroom) */
  maxTokens?: number
  /** Filter out import statements from chunks. Default: false */
  filterImports?: boolean
  /** Lines of overlap between chunks. Default: 0 */
  overlapLines?: number
  /** Concurrency for batch operations. Default: 10 */
  concurrency?: number
}

function resolveOptions(options: CodeChunkerOptions = {}) {
  const {
    maxTokens,
    maxChunkSize = maxTokens ? Math.floor(maxTokens * 3.5 * 0.85) : 1000,
    filterImports = false,
    overlapLines = 0,
  } = options

  return { maxChunkSize, filterImports, overlapLines }
}

function getNodeKind(node: ts.Node): string {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))
    return 'function'
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node))
    return 'class'
  if (ts.isInterfaceDeclaration(node))
    return 'interface'
  if (ts.isTypeAliasDeclaration(node))
    return 'type'
  if (ts.isEnumDeclaration(node))
    return 'enum'
  if (ts.isVariableDeclaration(node))
    return 'variable'
  if (ts.isMethodDeclaration(node))
    return 'method'
  if (ts.isPropertyDeclaration(node))
    return 'property'
  if (ts.isGetAccessor(node))
    return 'getter'
  if (ts.isSetAccessor(node))
    return 'setter'
  if (ts.isConstructorDeclaration(node))
    return 'constructor'
  if (ts.isModuleDeclaration(node))
    return 'namespace'
  return 'unknown'
}

function getNodeName(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) {
    return node.name?.getText()
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name.text
  }
  if (ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)
    || ts.isGetAccessor(node) || ts.isSetAccessor(node)) {
    return node.name?.getText()
  }
  return undefined
}

function getSignature(node: ts.Node, _sourceFile: ts.SourceFile): string {
  // For functions, build signature manually to handle anonymous functions safely
  if (ts.isFunctionDeclaration(node)) {
    const name = node.name?.getText() || 'anonymous'
    const params = node.parameters.map(p => p.getText()).join(', ')
    const returnType = node.type ? `: ${node.type.getText()}` : ''
    const async = node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) ? 'async ' : ''
    const exported = node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ? 'export ' : ''
    return `${exported}${async}function ${name}(${params})${returnType}`
  }

  if (ts.isMethodDeclaration(node)) {
    const name = node.name?.getText() || 'anonymous'
    const params = node.parameters.map(p => p.getText()).join(', ')
    const returnType = node.type ? `: ${node.type.getText()}` : ''
    const async = node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) ? 'async ' : ''
    return `${async}${name}(${params})${returnType}`
  }

  if (ts.isClassDeclaration(node)) {
    const name = node.name?.getText() || 'anonymous'
    const heritage = node.heritageClauses?.map(h => h.getText()).join(' ') || ''
    return `class ${name}${heritage ? ` ${heritage}` : ''}`
  }

  if (ts.isInterfaceDeclaration(node)) {
    const name = node.name.getText()
    const heritage = node.heritageClauses?.map(h => h.getText()).join(' ') || ''
    return `interface ${name}${heritage ? ` ${heritage}` : ''}`
  }

  if (ts.isVariableDeclaration(node)) {
    const name = node.name.getText()
    const type = node.type?.getText() || ''
    return type ? `${name}: ${type}` : name
  }

  return getNodeName(node) || ''
}

interface ParsedDeclaration {
  node: ts.Node
  name: string
  type: string
  signature: string
  start: number
  end: number
  lineStart: number
  lineEnd: number
  children: ParsedDeclaration[]
}

function extractImports(sourceFile: ts.SourceFile): ChunkImport[] {
  const imports: ChunkImport[] = []

  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const moduleSpecifier = stmt.moduleSpecifier
      if (!ts.isStringLiteral(moduleSpecifier))
        continue

      const source = moduleSpecifier.text
      const clause = stmt.importClause

      if (!clause) {
        // Side-effect import
        imports.push({ name: source, source })
        continue
      }

      if (clause.name) {
        imports.push({ name: clause.name.text, source, isDefault: true })
      }

      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          imports.push({ name: clause.namedBindings.name.text, source, isNamespace: true })
        }
        else if (ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) {
            imports.push({ name: el.name.text, source })
          }
        }
      }
    }
  }

  return imports
}

function parseDeclarations(sourceFile: ts.SourceFile): ParsedDeclaration[] {
  const declarations: ParsedDeclaration[] = []

  function visit(node: ts.Node, parent?: ParsedDeclaration) {
    const kind = getNodeKind(node)
    const name = getNodeName(node)

    if (name && kind !== 'unknown') {
      const { line: lineStart } = sourceFile.getLineAndCharacterOfPosition(node.getStart())
      const { line: lineEnd } = sourceFile.getLineAndCharacterOfPosition(node.getEnd())

      const decl: ParsedDeclaration = {
        node,
        name,
        type: kind,
        signature: getSignature(node, sourceFile),
        start: node.getStart(),
        end: node.getEnd(),
        lineStart: lineStart + 1, // 1-indexed
        lineEnd: lineEnd + 1,
        children: [],
      }

      if (parent) {
        parent.children.push(decl)
      }
      else {
        declarations.push(decl)
      }

      // Recurse into children for nested declarations
      ts.forEachChild(node, child => visit(child, decl))
    }
    else {
      // Continue traversing
      ts.forEachChild(node, child => visit(child, parent))
    }
  }

  ts.forEachChild(sourceFile, node => visit(node))
  return declarations
}

function declarationsToEntities(decls: ParsedDeclaration[]): ChunkEntity[] {
  return decls.map(d => ({
    name: d.name,
    type: d.type,
    signature: d.signature || undefined,
  }))
}

function buildScopeChain(decl: ParsedDeclaration, allDecls: ParsedDeclaration[]): ChunkEntity[] {
  const scope: ChunkEntity[] = []

  function findParent(target: ParsedDeclaration, candidates: ParsedDeclaration[]): ParsedDeclaration | null {
    for (const c of candidates) {
      if (c.children.includes(target)) {
        return c
      }
      const found = findParent(target, c.children)
      if (found)
        return found
    }
    return null
  }

  let current: ParsedDeclaration | null = decl
  while (current) {
    const parent = findParent(current, allDecls)
    if (parent) {
      scope.push({ name: parent.name, type: parent.type })
    }
    current = parent
  }

  return scope
}

function getSiblings(decl: ParsedDeclaration, allDecls: ParsedDeclaration[]): ChunkSibling[] {
  const siblings: ChunkSibling[] = []
  const idx = allDecls.indexOf(decl)
  if (idx === -1)
    return siblings

  // Before
  for (let i = idx - 1; i >= 0 && i >= idx - 3; i--) {
    const sib = allDecls[i]!
    siblings.push({
      name: sib.name,
      type: sib.type,
      position: 'before',
      distance: idx - i,
    })
  }

  // After
  for (let i = idx + 1; i < allDecls.length && i <= idx + 3; i++) {
    const sib = allDecls[i]!
    siblings.push({
      name: sib.name,
      type: sib.type,
      position: 'after',
      distance: i - idx,
    })
  }

  return siblings
}

interface ChunkRange {
  start: number
  end: number
  lineStart: number
  lineEnd: number
  entities: ParsedDeclaration[]
}

function splitIntoChunks(
  content: string,
  declarations: ParsedDeclaration[],
  maxChunkSize: number,
  filterImports: boolean,
  sourceFile: ts.SourceFile,
): ChunkRange[] {
  if (content.length <= maxChunkSize) {
    // Single chunk
    const lines = content.split('\n')
    return [{
      start: 0,
      end: content.length,
      lineStart: 1,
      lineEnd: lines.length,
      entities: declarations,
    }]
  }

  // Find import end position
  let importEnd = 0
  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt)) {
      importEnd = stmt.getEnd()
    }
    else {
      break
    }
  }

  const chunks: ChunkRange[] = []
  let currentStart = filterImports ? importEnd : 0
  let currentEntities: ParsedDeclaration[] = []

  // Group declarations into chunks
  for (const decl of declarations) {
    const declSize = decl.end - decl.start
    const currentSize = decl.end - currentStart

    if (currentSize > maxChunkSize && currentEntities.length > 0) {
      // Flush current chunk
      const lastEntity = currentEntities[currentEntities.length - 1]!
      const { line: lineStart } = sourceFile.getLineAndCharacterOfPosition(currentStart)
      const { line: lineEnd } = sourceFile.getLineAndCharacterOfPosition(lastEntity.end)

      chunks.push({
        start: currentStart,
        end: lastEntity.end,
        lineStart: lineStart + 1,
        lineEnd: lineEnd + 1,
        entities: currentEntities,
      })

      currentStart = decl.start
      currentEntities = [decl]
    }
    else if (declSize > maxChunkSize) {
      // Single large declaration - split it
      if (currentEntities.length > 0) {
        const lastEntity = currentEntities[currentEntities.length - 1]!
        const { line: lineStart } = sourceFile.getLineAndCharacterOfPosition(currentStart)
        const { line: lineEnd } = sourceFile.getLineAndCharacterOfPosition(lastEntity.end)
        chunks.push({
          start: currentStart,
          end: lastEntity.end,
          lineStart: lineStart + 1,
          lineEnd: lineEnd + 1,
          entities: currentEntities,
        })
      }

      // Add the large declaration as its own chunk(s)
      const { line: declLineStart } = sourceFile.getLineAndCharacterOfPosition(decl.start)
      const { line: declLineEnd } = sourceFile.getLineAndCharacterOfPosition(decl.end)
      chunks.push({
        start: decl.start,
        end: decl.end,
        lineStart: declLineStart + 1,
        lineEnd: declLineEnd + 1,
        entities: [decl],
      })

      currentStart = decl.end
      currentEntities = []
    }
    else {
      currentEntities.push(decl)
    }
  }

  // Flush remaining
  if (currentEntities.length > 0) {
    const lastEntity = currentEntities[currentEntities.length - 1]!
    const { line: lineStart } = sourceFile.getLineAndCharacterOfPosition(currentStart)
    const { line: lineEnd } = sourceFile.getLineAndCharacterOfPosition(lastEntity.end)
    chunks.push({
      start: currentStart,
      end: lastEntity.end,
      lineStart: lineStart + 1,
      lineEnd: lineEnd + 1,
      entities: currentEntities,
    })
  }

  // If no chunks created, return entire content
  if (chunks.length === 0) {
    const lines = content.split('\n')
    return [{
      start: 0,
      end: content.length,
      lineStart: 1,
      lineEnd: lines.length,
      entities: declarations,
    }]
  }

  return chunks
}

/**
 * Create a code-aware chunker using TypeScript compiler API.
 * Extracts entities, scope, imports, and siblings for context.
 *
 * Supports: TypeScript, JavaScript (including .tsx, .jsx, .mts, .cts, .mjs, .cjs)
 */
export function codeChunker(options: CodeChunkerOptions = {}): Chunker {
  const opts = resolveOptions(options)

  return async (content: string, meta?): Promise<ChunkerChunk[]> => {
    const filepath = meta?.id || 'file.ts'

    // Determine script kind from extension
    const ext = filepath.split('.').pop()?.toLowerCase() || 'ts'
    let scriptKind = ts.ScriptKind.TS
    if (ext === 'tsx')
      scriptKind = ts.ScriptKind.TSX
    else if (ext === 'js' || ext === 'mjs' || ext === 'cjs')
      scriptKind = ts.ScriptKind.JS
    else if (ext === 'jsx')
      scriptKind = ts.ScriptKind.JSX

    const sourceFile = ts.createSourceFile(filepath, content, ts.ScriptTarget.Latest, true, scriptKind)
    const declarations = parseDeclarations(sourceFile)
    const imports = extractImports(sourceFile)

    const chunkRanges = splitIntoChunks(content, declarations, opts.maxChunkSize, opts.filterImports, sourceFile)

    return chunkRanges.map((range) => {
      let text = content.slice(range.start, range.end).trim()

      // Handle overlap
      if (opts.overlapLines > 0 && range.lineStart > 1) {
        const lines = content.split('\n')
        const overlapStart = Math.max(0, range.lineStart - 1 - opts.overlapLines)
        const overlapText = lines.slice(overlapStart, range.lineStart - 1).join('\n')
        if (overlapText.trim()) {
          text = `${overlapText}\n${text}`
        }
      }

      const entities = declarationsToEntities(range.entities)

      // Build scope for first entity
      const scope = range.entities.length > 0
        ? buildScopeChain(range.entities[0]!, declarations)
        : []

      // Get siblings for chunk
      const siblings = range.entities.length > 0
        ? getSiblings(range.entities[0]!, declarations)
        : []

      // Build context string from scope
      const context = scope.length > 0
        ? scope.map(s => `${s.type} ${s.name}`).join(' > ')
        : undefined

      const chunk: ChunkerChunk = {
        text,
        lineRange: [range.lineStart, range.lineEnd],
      }

      if (context)
        chunk.context = context
      if (entities.length > 0)
        chunk.entities = entities
      if (scope.length > 0)
        chunk.scope = scope
      if (imports.length > 0)
        chunk.imports = imports
      if (siblings.length > 0)
        chunk.siblings = siblings

      return chunk
    })
  }
}

export default codeChunker
