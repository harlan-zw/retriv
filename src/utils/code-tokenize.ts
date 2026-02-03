/**
 * Split a compound identifier into parts.
 * getUserName -> ['get', 'User', 'Name']
 * get_user_name -> ['get', 'user', 'name']
 * MAX_RETRY_COUNT -> ['MAX', 'RETRY', 'COUNT']
 */
function splitIdentifier(token: string): string[] {
  // Split on dots first
  if (token.includes('.')) {
    return token.split('.').flatMap(splitIdentifier)
  }
  // Split on underscores
  if (token.includes('_')) {
    return token.split('_').filter(Boolean)
  }
  // Split camelCase/PascalCase
  const parts = token.replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(' ')
    .filter(Boolean)
  return parts.length > 1 ? parts : [token]
}

/**
 * Check if a token looks like a code identifier
 */
function isCodeIdentifier(token: string): boolean {
  return /[a-z][A-Z]/.test(token)
    || /[A-Z][A-Z][a-z]/.test(token)
    || token.includes('_')
    || token.includes('.')
}

/**
 * Tokenize a search query for code-aware BM25 matching.
 *
 * Expands code identifiers into their parts while preserving the original.
 * getUserName -> "get User Name getUserName"
 *
 * Natural language queries pass through unchanged.
 */
export function tokenizeCodeQuery(query: string): string {
  const tokens = query.split(/\s+/).filter(Boolean)
  const expanded: string[] = []

  for (const token of tokens) {
    if (isCodeIdentifier(token)) {
      const parts = splitIdentifier(token)
      if (parts.length > 1) {
        expanded.push(...parts, token)
      }
      else {
        expanded.push(token)
      }
    }
    else {
      expanded.push(token)
    }
  }

  return expanded.join(' ')
}
