/** Percentage, or an em dash when the value is undefined. */
export const pct = (value: number | null, digits = 1): string =>
  value === null ? '—' : `${(value * 100).toFixed(digits)}%`

/** Signed percentage, for deltas. */
export const signedPct = (value: number | null, digits = 2): string =>
  value === null ? '—' : `${value > 0 ? '+' : value < 0 ? '−' : ''}${(Math.abs(value) * 100).toFixed(digits)}%`

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
