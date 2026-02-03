import type { FilterOperator, SearchFilter } from './types'

type FilterMode = 'json' | 'jsonb'

interface CompiledFilter {
  sql: string
  params: (string | number | boolean)[]
}

function isOperator(v: unknown): v is FilterOperator {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function fieldRef(field: string, mode: FilterMode): string {
  return mode === 'json'
    ? `json_extract(metadata, '$.${field}')`
    : `metadata->>'${field}'`
}

function compileOp(ref: string, op: FilterOperator): CompiledFilter {
  if ('$eq' in op)
    return { sql: `${ref} = ?`, params: [op.$eq] }
  if ('$ne' in op)
    return { sql: `${ref} != ?`, params: [op.$ne] }
  if ('$gt' in op)
    return { sql: `${ref} > ?`, params: [op.$gt] }
  if ('$gte' in op)
    return { sql: `${ref} >= ?`, params: [op.$gte] }
  if ('$lt' in op)
    return { sql: `${ref} < ?`, params: [op.$lt] }
  if ('$lte' in op)
    return { sql: `${ref} <= ?`, params: [op.$lte] }
  if ('$in' in op) {
    const placeholders = op.$in.map(() => '?').join(', ')
    return { sql: `${ref} IN (${placeholders})`, params: [...op.$in] }
  }
  if ('$prefix' in op)
    return { sql: `${ref} LIKE ?`, params: [`${op.$prefix}%`] }
  if ('$exists' in op) {
    return op.$exists
      ? { sql: `${ref} IS NOT NULL`, params: [] }
      : { sql: `${ref} IS NULL`, params: [] }
  }
  return { sql: '', params: [] }
}

/**
 * Compile a SearchFilter to SQL WHERE clause fragments.
 * mode: 'json' for SQLite json_extract, 'jsonb' for PostgreSQL ->>
 */
export function compileFilter(filter: SearchFilter | undefined, mode: FilterMode): CompiledFilter {
  if (!filter || Object.keys(filter).length === 0)
    return { sql: '', params: [] }

  const clauses: string[] = []
  const params: (string | number | boolean)[] = []

  for (const [field, value] of Object.entries(filter)) {
    const ref = fieldRef(field, mode)
    if (isOperator(value)) {
      const compiled = compileOp(ref, value)
      clauses.push(compiled.sql)
      params.push(...compiled.params)
    }
    else {
      // Exact match shorthand
      clauses.push(`${ref} = ?`)
      params.push(value)
    }
  }

  return { sql: clauses.join(' AND '), params }
}

function matchOp(actual: unknown, op: FilterOperator): boolean {
  if ('$eq' in op)
    return actual === op.$eq
  if ('$ne' in op)
    return actual !== op.$ne
  if ('$gt' in op)
    return typeof actual === 'number' && actual > op.$gt
  if ('$gte' in op)
    return typeof actual === 'number' && actual >= op.$gte
  if ('$lt' in op)
    return typeof actual === 'number' && actual < op.$lt
  if ('$lte' in op)
    return typeof actual === 'number' && actual <= op.$lte
  if ('$in' in op)
    return op.$in.includes(actual as string | number)
  if ('$prefix' in op)
    return typeof actual === 'string' && actual.startsWith(op.$prefix)
  if ('$exists' in op)
    return op.$exists ? actual != null : actual == null
  return false
}

/**
 * Check if a metadata record matches a filter in-memory.
 */
export function matchesFilter(filter: SearchFilter | undefined, metadata: Record<string, any> | undefined): boolean {
  if (!filter || Object.keys(filter).length === 0)
    return true
  if (!metadata)
    return false

  for (const [field, value] of Object.entries(filter)) {
    const actual = metadata[field]
    if (isOperator(value)) {
      if (!matchOp(actual, value))
        return false
    }
    else {
      if (actual !== value)
        return false
    }
  }

  return true
}

/**
 * Convert ? placeholders to $N for PostgreSQL. offset is starting param number.
 */
export function pgParams(sql: string, offset: number = 1): string {
  let i = offset
  return sql.replace(/\?/g, () => `$${i++}`)
}
