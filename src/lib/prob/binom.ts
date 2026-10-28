/**
 * Exact binomial coefficient.
 *
 * The interleaved multiply/divide keeps every intermediate an exact integer
 * (after step i, `r` is exactly C(n, i+1)), so results are exact in float64 as
 * long as they stay under 2^53. This tool only ever needs k <= 13 — hand sizes
 * up to 8, prizes up to 6 — where the largest value is C(60,13) ~ 2.0e13, well
 * inside the safe range. The assertion catches any future caller that strays
 * outside it rather than silently returning a rounded answer.
 */
export function binom(n: number, k: number): number {
  if (k < 0 || n < 0 || k > n) return 0
  const kk = Math.min(k, n - k)
  let r = 1
  for (let i = 0; i < kk; i++) {
    r = (r * (n - i)) / (i + 1)
  }
  const result = Math.round(r)
  if (!Number.isSafeInteger(result)) {
    throw new Error(`binom(${n}, ${k}) exceeds exact integer range`)
  }
  return result
}
