import type { Document } from '../../../src/types'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const CACHE_PATH = '.retriv/fixtures/nuxt-docs.txt'
const SOURCE_URL = 'https://nuxt.com/llms-full.txt'

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

  return text
    .split(/^# /m)
    .filter(s => s.trim().length > 0)
    .map((section, i) => ({
      id: `section-${i}`,
      content: `# ${section}`.trim(),
    }))
}
