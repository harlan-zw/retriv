import { describe, expect, it } from 'vitest'
import { tokenizeCodeQuery } from '../src/utils/code-tokenize'

describe('tokenizeCodeQuery', () => {
  it('splits camelCase identifiers', () => {
    expect(tokenizeCodeQuery('getUserName')).toBe('get User Name getUserName')
  })

  it('splits snake_case identifiers', () => {
    expect(tokenizeCodeQuery('get_user_name')).toBe('get user name get_user_name')
  })

  it('splits PascalCase identifiers', () => {
    expect(tokenizeCodeQuery('UserService')).toBe('User Service UserService')
  })

  it('preserves natural language queries', () => {
    expect(tokenizeCodeQuery('how to get user')).toBe('how to get user')
  })

  it('handles mixed queries', () => {
    const result = tokenizeCodeQuery('find getUserName function')
    expect(result).toContain('get')
    expect(result).toContain('User')
    expect(result).toContain('Name')
    expect(result).toContain('getUserName')
    expect(result).toContain('find')
    expect(result).toContain('function')
  })

  it('handles SCREAMING_SNAKE_CASE', () => {
    expect(tokenizeCodeQuery('MAX_RETRY_COUNT')).toBe('MAX RETRY COUNT MAX_RETRY_COUNT')
  })

  it('handles dotted paths', () => {
    const result = tokenizeCodeQuery('React.useState')
    expect(result).toContain('React')
    expect(result).toContain('useState')
    expect(result).toContain('use')
    expect(result).toContain('State')
  })
})
