import type { Document } from '../../../src/types'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { splitText } from '../../../src/utils/split-text'

const CACHE_PATH = '.retriv/fixtures/nuxt-docs.txt'
const SOURCE_URL = 'https://nuxt.com/llms-full.txt'

// Max chars per chunk (BGE model has 512 token limit ≈ 2000 chars)
const MAX_CHUNK_SIZE = 1500

export async function loadNuxtDocs(): Promise<Document[]> {
  let text: string

  if (existsSync(CACHE_PATH)) {
    text = readFileSync(CACHE_PATH, 'utf8')
  }
  else {
    const res = await fetch(SOURCE_URL)
    if (!res.ok)
      throw new Error(`Failed to fetch ${SOURCE_URL}: ${res.status}`)
    text = await res.text()

    mkdirSync(dirname(CACHE_PATH), { recursive: true })
    writeFileSync(CACHE_PATH, text)
  }

  // Split on actual h1 headers (preceded by blank line or at start)
  // This avoids matching code comments like "# bun --bun run dev"
  const sections = text
    .split(/\n\n(?=# [A-Z])/)
    .filter(s => s.trim().length > 0 && s.trim().startsWith('# '))

  // Chunk large sections for better embedding quality
  const docs: Document[] = []
  for (const section of sections) {
    const title = section.split('\n')[0] || 'Untitled'

    if (section.length <= MAX_CHUNK_SIZE) {
      docs.push({
        id: `doc-${docs.length}`,
        content: section.trim(),
        metadata: { title },
      })
    }
    else {
      // Split large sections into chunks
      const chunks = splitText(section, { chunkSize: MAX_CHUNK_SIZE, chunkOverlap: 200 })
      for (const chunk of chunks) {
        docs.push({
          id: `doc-${docs.length}`,
          content: chunk.text.trim(),
          metadata: { title, chunk: chunk.index },
        })
      }
    }
  }

  return docs
}
