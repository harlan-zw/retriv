import type { FilterOperator, SearchFilter } from './types'

type FilterMode = 'json' | 'jsonb'

interface CompiledFilter {
  sql: string
  params: (string | number)[]
}

function isOperator(v: unknown): v is FilterOperator {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Convert boolean to 0/1 for SQL compatibility */
function sqlVal(v: string | number | boolean): string | number {
  return typeof v === 'boolean' ? (v ? 1 : 0) : v
}

function fieldRef(field: string, mode: FilterMode, table?: string): string {
  const col = table ? `${table}.metadata` : 'metadata'
  return mode === 'json'
    ? `json_extract(${col}, '$.${field}')`
    : `${col}->>'${field}'`
}

function compileOp(ref: string, op: FilterOperator): CompiledFilter {
  if ('$eq' in op)
    return { sql: `${ref} = ?`, params: [sqlVal(op.$eq)] }
  if ('$ne' in op)
    return { sql: `${ref} != ?`, params: [sqlVal(op.$ne)] }
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
 * table: optional table alias prefix for metadata column (e.g. 'meta' -> meta.metadata)
 */
export function compileFilter(filter: SearchFilter | undefined, mode: FilterMode, table?: string): CompiledFilter {
  if (!filter || Object.keys(filter).length === 0)
    return { sql: '', params: [] }

  const clauses: string[] = []
  const params: (string | number)[] = []

  for (const [field, value] of Object.entries(filter)) {
    const ref = fieldRef(field, mode, table)
    if (isOperator(value)) {
      const compiled = compileOp(ref, value)
      clauses.push(compiled.sql)
      params.push(...compiled.params)
    }
    else {
      // Exact match shorthand
      clauses.push(`${ref} = ?`)
      params.push(sqlVal(value))
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
