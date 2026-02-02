import type { Document } from '../../../src/types'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const REFS_PATH = '.retriv/skill/nuxt.com/references'

interface RefMeta {
  id: string
  source: string
  title: string
  chunk?: string
}

function parseFrontmatter(content: string): { meta: RefMeta, body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) {
    return { meta: { id: '', source: '', title: '' }, body: content }
  }

  const yaml = match[1]
  const body = match[2]

  const meta: RefMeta = {
    id: yaml.match(/id:\s*"([^"]+)"/)?.[1] || '',
    source: yaml.match(/source:\s*"([^"]+)"/)?.[1] || '',
    title: yaml.match(/title:\s*"([^"]+)"/)?.[1] || '',
    chunk: yaml.match(/chunk:\s*(\S+)/)?.[1],
  }

  return { meta, body }
}

export function loadNuxtReferences(): Document[] {
  const files = readdirSync(REFS_PATH).filter(f => f.endsWith('.md'))

  return files.map((filename) => {
    const filepath = join(REFS_PATH, filename)
    const content = readFileSync(filepath, 'utf8')
    const { meta, body } = parseFrontmatter(content)

    return {
      id: meta.id || filename,
      content: body.trim(),
      metadata: {
        source: filepath, // Local path for agent to read
        url: meta.source, // Original URL
        title: meta.title,
        chunk: meta.chunk,
        filename,
      },
    }
  })
}

export { REFS_PATH }
