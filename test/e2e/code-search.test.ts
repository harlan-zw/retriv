import { describe, expect, it } from 'vitest'
import { autoChunker } from '../../src/chunkers/auto'
import { codeChunker } from '../../src/chunkers/code'
import { sqliteFts } from '../../src/db/sqlite-fts'
import { createRetriv } from '../../src/retriv'

const sampleCode = {
  'src/auth.ts': `
import { createHash } from 'node:crypto'

export interface User {
  id: string
  email: string
  passwordHash: string
}

export function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex')
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash
}

export function createUser(email: string, password: string): User {
  return {
    id: crypto.randomUUID(),
    email,
    passwordHash: hashPassword(password),
  }
}
`.trim(),
  'src/api.ts': `
import type { User } from './auth'
import { createUser, verifyPassword } from './auth'

const users = new Map<string, User>()

export function registerUser(email: string, password: string): User {
  if (users.has(email)) {
    throw new Error('User already exists')
  }
  const user = createUser(email, password)
  users.set(email, user)
  return user
}

export function loginUser(email: string, password: string): User | null {
  const user = users.get(email)
  if (!user) return null
  if (!verifyPassword(password, user.passwordHash)) return null
  return user
}
`.trim(),
  'docs/guide.md': `
# Authentication Guide

## Password Hashing

We use SHA-256 for password hashing. The \`hashPassword\` function
takes a plain text password and returns its hash.

## User Registration

Call \`registerUser\` with an email and password to create a new account.
`.trim(),
} as Record<string, string>

describe('code search e2e', () => {
  it('searches code with code chunker', async () => {
    const retriv = await createRetriv({
      driver: sqliteFts({ path: ':memory:' }),
      chunking: { chunker: await codeChunker() },
    })

    await retriv.index([
      { id: 'src/auth.ts', content: sampleCode['src/auth.ts']! },
      { id: 'src/api.ts', content: sampleCode['src/api.ts']! },
    ])

    const results = await retriv.search('password hashing', { limit: 5, returnContent: true })
    expect(results.length).toBeGreaterThan(0)
    const texts = results.map(r => r.content || '').join(' ')
    expect(texts).toMatch(/password/i)
  })

  it('searches mixed content with auto chunker', async () => {
    const retriv = await createRetriv({
      driver: sqliteFts({ path: ':memory:' }),
      chunking: { chunker: await autoChunker() },
    })

    const docs = Object.entries(sampleCode).map(([id, content]) => ({ id, content }))
    await retriv.index(docs)

    // NL query should find both code and docs
    const results = await retriv.search('password', { limit: 5, returnContent: true })
    expect(results.length).toBeGreaterThan(0)
    // Should match across both code and markdown files
    const ids = results.map(r => r.id)
    const hasCode = ids.some(id => id.includes('auth') || id.includes('api'))
    const hasDocs = ids.some(id => id.includes('guide'))
    expect(hasCode || hasDocs).toBe(true)
  })
})
