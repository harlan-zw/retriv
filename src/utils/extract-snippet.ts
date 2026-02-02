export interface SnippetResult {
  snippet: string
  highlights: string[]
}

// Common stopwords to deprioritize
const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'as',
  'is',
  'was',
  'are',
  'were',
  'been',
  'be',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'must',
  'can',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'they',
  'them',
  'their',
  'we',
  'our',
  'you',
  'your',
  'what',
  'which',
  'who',
  'how',
  'when',
  'where',
  'why',
  'all',
  'each',
  'every',
  'both',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'not',
  'only',
])

/**
 * BM25-style term scoring for highlights
 * Scores terms by: inverse frequency in content (rarer = better) + not stopword
 */
function scoreTerms(terms: string[], content: string): Array<{ term: string, score: number }> {
  const contentLower = content.toLowerCase()
  const contentLen = content.length

  return terms
    .filter(t => contentLower.includes(t))
    .map((term) => {
      // Count occurrences
      const regex = new RegExp(term, 'gi')
      const matches = contentLower.match(regex)
      const tf = matches ? matches.length : 0

      // BM25-style: prefer terms that appear but not too frequently
      // k1=1.2, b=0.75 are typical BM25 params
      const k1 = 1.2
      const avgDocLen = 500 // assumed average
      const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - 0.75 + 0.75 * (contentLen / avgDocLen)))

      // Penalize stopwords
      const stopwordPenalty = STOPWORDS.has(term) ? 0.1 : 1

      // Prefer longer terms (more specific)
      const lengthBoost = Math.min(term.length / 5, 1.5)

      return { term, score: tfNorm * stopwordPenalty * lengthBoost }
    })
    .sort((a, b) => b.score - a.score)
}

/**
 * Extract a snippet around query matches from content
 * Returns snippet and BM25-scored highlights for _meta
 */
export function extractSnippet(content: string, query: string, contextLines = 2): SnippetResult {
  const lines = content.split('\n')
  const totalContext = contextLines * 2 + 1
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)

  // BM25-scored highlights (top 5 most relevant terms)
  const scoredTerms = scoreTerms(queryWords, content)
  const highlights = scoredTerms.slice(0, 5).map(t => t.term)

  // Already small enough
  if (lines.length <= totalContext)
    return { snippet: content, highlights }

  // Score each line by weighted term matches
  const termScores = new Map(scoredTerms.map(t => [t.term, t.score]))
  let bestIdx = 0
  let bestScore = 0

  for (let i = 0; i < lines.length; i++) {
    const lineLower = lines[i].toLowerCase()
    let score = 0
    for (const word of queryWords) {
      if (lineLower.includes(word))
        score += termScores.get(word) || 1
    }
    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  }

  // No matches - return first lines
  if (bestScore === 0) {
    return { snippet: lines.slice(0, totalContext).join('\n'), highlights }
  }

  const start = Math.max(0, bestIdx - contextLines)
  const end = Math.min(lines.length, bestIdx + contextLines + 1)
  return { snippet: lines.slice(start, end).join('\n'), highlights }
}
