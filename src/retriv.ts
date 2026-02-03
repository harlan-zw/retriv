import type { ComposedDriver, Document, DriverInput, RetrivOptions, SearchOptions, SearchProvider, SearchResult } from './types'
import { tokenizeCodeQuery } from './utils/code-tokenize'
import { splitText } from './utils/split-text'

const RRF_K = 60

/**
 * Check if driver input is composed (has vector/keyword properties)
 */
function isComposed(driver: DriverInput): driver is ComposedDriver {
  return typeof driver === 'object' && driver !== null && ('vector' in driver || 'keyword' in driver)
}

/**
 * Apply Reciprocal Rank Fusion to merge results from multiple drivers
 */
function applyRRF(resultSets: SearchResult[][]): SearchResult[] {
  const scores = new Map<string, { score: number, result: SearchResult }>()

  for (const results of resultSets) {
    for (let rank = 0; rank < results.length; rank++) {
      const result = results[rank]
      const rrfScore = 1 / (RRF_K + rank + 1)
      const existing = scores.get(result.id)

      if (existing) {
        existing.score += rrfScore
        if (result.content && !existing.result.content)
          existing.result = { ...existing.result, content: result.content }
        if (result.metadata && !existing.result.metadata)
          existing.result = { ...existing.result, metadata: result.metadata }
      }
      else {
        scores.set(result.id, { score: rrfScore, result })
      }
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map(({ score, result }) => ({ ...result, score }))
}

/**
 * Create a unified retrieval instance
 */
export async function createRetriv(options: RetrivOptions): Promise<SearchProvider> {
  const { driver: driverInput, chunking } = options

  // Resolve driver(s)
  let drivers: SearchProvider[]

  if (isComposed(driverInput)) {
    const resolved = await Promise.all([
      driverInput.vector ? Promise.resolve(driverInput.vector) : null,
      driverInput.keyword ? Promise.resolve(driverInput.keyword) : null,
    ])
    drivers = resolved.filter(d => d !== null) as SearchProvider[]

    if (drivers.length === 0)
      throw new Error('At least one driver (vector or keyword) is required')
  }
  else {
    const resolved = await Promise.resolve(driverInput)
    drivers = [resolved]
  }

  const isHybrid = drivers.length > 1
  const parentDocs = new Map<string, Document>()

  async function prepareDocs(docs: Document[]): Promise<Document[]> {
    if (!chunking)
      return docs

    const { chunkSize = 1000, chunkOverlap = 200, chunker } = chunking
    const chunkedDocs: Document[] = []

    for (const doc of docs) {
      let chunks: { text: string, range?: [number, number], context?: string }[]

      if (chunker) {
        chunks = await chunker(doc.content, { id: doc.id, metadata: doc.metadata })
      }
      else {
        chunks = splitText(doc.content, { chunkSize, chunkOverlap })
      }

      if (chunks.length <= 1) {
        chunkedDocs.push(doc)
      }
      else {
        parentDocs.set(doc.id, doc)
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i]!
          const content = chunk.context
            ? `${chunk.context}\n${chunk.text}`
            : chunk.text
          chunkedDocs.push({
            id: `${doc.id}#chunk-${i}`,
            content,
            metadata: {
              ...doc.metadata,
              _parentId: doc.id,
              _chunkIndex: i,
              _chunkRange: chunk.range,
            },
          })
        }
      }
    }

    return chunkedDocs
  }

  function annotateChunks(results: SearchResult[]): SearchResult[] {
    if (!chunking)
      return results

    return results.map((result) => {
      const metadata = result.metadata || {}
      const parentId = metadata._parentId as string | undefined
      const chunkIndex = metadata._chunkIndex as number | undefined
      const chunkRange = metadata._chunkRange as [number, number] | undefined

      if (parentId !== undefined && chunkIndex !== undefined) {
        const { _parentId, _chunkIndex, _chunkRange, ...cleanMeta } = metadata
        return {
          ...result,
          metadata: Object.keys(cleanMeta).length > 0 ? cleanMeta : undefined,
          _chunk: {
            parentId,
            index: chunkIndex,
            range: chunkRange,
          },
        }
      }

      return result
    })
  }

  return {
    async index(docs: Document[]) {
      const prepared = await prepareDocs(docs)
      const results = await Promise.all(drivers.map(d => d.index(prepared)))
      return { count: results[0].count }
    },

    async search(query: string, searchOptions: SearchOptions = {}): Promise<SearchResult[]> {
      const expandedQuery = tokenizeCodeQuery(query)

      if (!isHybrid) {
        const results = await drivers[0].search(expandedQuery, searchOptions)
        return annotateChunks(results)
      }

      const resultSets = await Promise.all(
        drivers.map(d => d.search(expandedQuery, searchOptions)),
      )

      let merged = applyRRF(resultSets)

      if (searchOptions.limit)
        merged = merged.slice(0, searchOptions.limit)

      return annotateChunks(merged)
    },

    async remove(ids: string[]) {
      const results = await Promise.all(
        drivers.filter(d => d.remove).map(d => d.remove!(ids)),
      )
      return { count: results[0]?.count ?? 0 }
    },

    async clear() {
      await Promise.all(drivers.filter(d => d.clear).map(d => d.clear!()))
      parentDocs.clear()
    },

    async close() {
      await Promise.all(drivers.filter(d => d.close).map(d => d.close!()))
    },
  }
}
